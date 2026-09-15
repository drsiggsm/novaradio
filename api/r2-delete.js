import {
  S3Client,
  DeleteObjectsCommand
} from "@aws-sdk/client-s3";

const SUPABASE_URL =
  "https://melsoikvhwzvzswlimsi.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_IOPT_ffm1Hp2bS3n3slD8w_3lmBaUdm";

const R2_PUBLIC_BASE_URL =
  "https://pub-f729f197decc4432acbc18188b3342b2.r2.dev";

function normalizeEndpoint(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/novaradio-audio$/, "");
}

function keyToPublicUrl(key) {
  return `${R2_PUBLIC_BASE_URL}/${String(key || "")
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

async function getSupabaseUser(accessToken) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    return null;
  }

  return await response.json();
}

/*
  指定されたR2キーが、
  ログイン中ユーザー本人の songs レコードに
  紐づいているか確認する。
*/
async function userOwnsKey(
  accessToken,
  userId,
  key
) {
  const publicUrl = keyToPublicUrl(key);

  const params = new URLSearchParams();

  params.set(
    "select",
    "id,audio_url,highlight_audio_url"
  );

  params.set(
    "user_id",
    `eq.${userId}`
  );

  params.set(
    "or",
    `(audio_url.eq.${publicUrl},highlight_audio_url.eq.${publicUrl})`
  );

  params.set(
    "limit",
    "1"
  );

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/songs?${params.toString()}`,
    {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    const text = await response.text();

    console.error(
      "Supabase ownership check failed:",
      response.status,
      text
    );

    throw new Error(
      "曲の所有者確認に失敗しました。"
    );
  }

  const rows = await response.json();

  return Array.isArray(rows) && rows.length > 0;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      ok: false,
      error: "Method Not Allowed"
    });
  }

  try {
    /*
      1. ログイン確認
    */
    const authHeader = String(
      req.headers.authorization || ""
    );

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        ok: false,
        error: "ログインが必要です。"
      });
    }

    const accessToken =
      authHeader.slice(7).trim();

    const user =
      await getSupabaseUser(accessToken);

    if (!user?.id) {
      return res.status(401).json({
        ok: false,
        error: "ログイン情報を確認できません。"
      });
    }

    /*
      2. 削除対象キー取得
    */
    const keys =
      Array.isArray(req.body?.keys)
        ? req.body.keys
        : [];

    const uniqueKeys = Array.from(
      new Set(
        keys
          .map(key =>
            String(key || "").trim()
          )
          .filter(Boolean)
      )
    );

    if (
      !uniqueKeys.length ||
      uniqueKeys.length > 10
    ) {
      return res.status(400).json({
        ok: false,
        error: "削除対象が正しくありません。"
      });
    }

    /*
      3. songs / highlights 以外は禁止
    */
    const invalidFolderKey =
      uniqueKeys.find(
        key =>
          !(
            key.startsWith("songs/") ||
            key.startsWith("highlights/")
          )
      );

    if (invalidFolderKey) {
      return res.status(403).json({
        ok: false,
        error:
          "許可されていないファイルです。"
      });
    }

    /*
      4. 本人の曲に紐づいているR2ファイルか確認
    */
    for (const key of uniqueKeys) {
      const owned =
        await userOwnsKey(
          accessToken,
          user.id,
          key
        );

      if (!owned) {
        return res.status(403).json({
          ok: false,
          error:
            "このファイルを削除する権限がありません。"
        });
      }
    }

    /*
      5. R2設定
    */
    const endpoint =
      normalizeEndpoint(
        process.env.R2_ENDPOINT
      );

    const bucket = String(
      process.env.R2_BUCKET_NAME || ""
    ).trim();

    if (
      !endpoint ||
      !bucket ||
      !process.env.R2_ACCESS_KEY_ID ||
      !process.env.R2_SECRET_ACCESS_KEY
    ) {
      throw new Error(
        "R2環境変数が不足しています。"
      );
    }

    const client = new S3Client({
      region: "auto",
      endpoint,
      forcePathStyle: true,

      credentials: {
        accessKeyId:
          process.env.R2_ACCESS_KEY_ID,

        secretAccessKey:
          process.env.R2_SECRET_ACCESS_KEY
      }
    });

    /*
      6. R2から削除
    */
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,

        Delete: {
          Objects: uniqueKeys.map(Key => ({
            Key
          })),

          Quiet: false
        }
      })
    );

    if (
      Array.isArray(result.Errors) &&
      result.Errors.length > 0
    ) {
      console.error(
        "R2 delete partial errors:",
        result.Errors
      );

      return res.status(500).json({
        ok: false,
        error:
          "一部のR2ファイルを削除できませんでした。",
        details: result.Errors
      });
    }

    return res.status(200).json({
      ok: true,
      deleted: uniqueKeys
    });
  } catch (error) {
    console.error(
      "R2 delete error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "R2ファイルの削除に失敗しました。"
    });
  }
}
