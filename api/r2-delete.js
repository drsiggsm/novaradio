import {
  S3Client,
  DeleteObjectsCommand
} from "@aws-sdk/client-s3";

const SUPABASE_URL =
  "https://melsoikvhwzvzswlimsi.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_IOPT_ffm1Hp2bS3n3slD8w_3lmBaUdm";

function normalizeEndpoint(value){
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/novaradio-audio$/, "");
}

async function getSupabaseUser(accessToken){

  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers:{
          "apikey":
            SUPABASE_PUBLISHABLE_KEY,
          "Authorization":
            `Bearer ${accessToken}`
        }
      }
    );

  if(!response.ok){
    return null;
  }

  return await response.json();
}

export default async function handler(
  req,
  res
){

  if(req.method !== "POST"){
    res.setHeader(
      "Allow",
      "POST"
    );

    return res.status(405).json({
      ok:false,
      error:"Method Not Allowed"
    });
  }

  try{

    const authHeader =
      String(
        req.headers.authorization ||
        ""
      );

    if(
      !authHeader.startsWith(
        "Bearer "
      )
    ){
      return res.status(401).json({
        ok:false,
        error:"ログインが必要です。"
      });
    }

    const accessToken =
      authHeader.slice(7).trim();

    const user =
      await getSupabaseUser(
        accessToken
      );

    if(!user?.id){
      return res.status(401).json({
        ok:false,
        error:"ログイン情報を確認できません。"
      });
    }

    const keys =
      Array.isArray(
        req.body?.keys
      )
        ? req.body.keys
        : [];

    const uniqueKeys =
      Array.from(
        new Set(
          keys
          .map(
            key =>
              String(
                key || ""
              ).trim()
          )
          .filter(Boolean)
        )
      );

    if(
      !uniqueKeys.length ||
      uniqueKeys.length > 10
    ){
      return res.status(400).json({
        ok:false,
        error:"削除対象が正しくありません。"
      });
    }

    /*
      他ユーザーのR2ファイルを削除できないように、
      songs / highlights 配下かつ
      ファイル名がログイン中user_idで
      始まるものだけ許可する。
    */
    const allowedPrefixes = [
      `songs/${user.id}_`,
      `highlights/${user.id}_`
    ];

    const invalidKey =
      uniqueKeys.find(
        key =>
          !allowedPrefixes.some(
            prefix =>
              key.startsWith(
                prefix
              )
          )
      );

    if(invalidKey){
      return res.status(403).json({
        ok:false,
        error:
          "このファイルを削除する権限がありません。"
      });
    }

    const endpoint =
      normalizeEndpoint(
        process.env.R2_ENDPOINT
      );

    const bucket =
      String(
        process.env.R2_BUCKET_NAME ||
        ""
      ).trim();

    if(
      !endpoint ||
      !bucket ||
      !process.env.R2_ACCESS_KEY_ID ||
      !process.env.R2_SECRET_ACCESS_KEY
    ){
      throw new Error(
        "R2環境変数が不足しています。"
      );
    }

    const client =
      new S3Client({
        region:"auto",
        endpoint,
        forcePathStyle:true,
        credentials:{
          accessKeyId:
            process.env.R2_ACCESS_KEY_ID,
          secretAccessKey:
            process.env.R2_SECRET_ACCESS_KEY
        }
      });

    await client.send(
      new DeleteObjectsCommand({
        Bucket:bucket,
        Delete:{
          Objects:
            uniqueKeys.map(
              Key => ({
                Key
              })
            ),
          Quiet:false
        }
      })
    );

    return res.status(200).json({
      ok:true,
      deleted:uniqueKeys
    });

  }
  catch(error){

    console.error(
      "R2 delete error:",
      error
    );

    return res.status(500).json({
      ok:false,
      error:
        error?.message ||
        "R2ファイルの削除に失敗しました。"
    });

  }

}
