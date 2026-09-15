const {
  S3Client,
  PutObjectCommand
} = require("@aws-sdk/client-s3");

const {
  getSignedUrl
} = require("@aws-sdk/s3-request-presigner");


const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY;


const s3 = new S3Client({
  region: "auto",

  endpoint:
    process.env.R2_ENDPOINT,

  forcePathStyle: true,

  /*
    Cloudflare R2へのPresigned PUTでは、
    AWS SDKが自動追加するCRC32チェックサムを
    必須の場合だけにする。
  */
  requestChecksumCalculation:
    "WHEN_REQUIRED",

  responseChecksumValidation:
    "WHEN_REQUIRED",

  credentials: {
    accessKeyId:
      process.env.R2_ACCESS_KEY_ID,

    secretAccessKey:
      process.env.R2_SECRET_ACCESS_KEY,
  },
});


function sanitizeFileName(fileName) {

  const name =
    String(fileName || "")
      .split("/")
      .pop()
      .split("\\")
      .pop();

  return name.replace(
    /[^a-zA-Z0-9._-]/g,
    "_"
  );
}


async function getAuthenticatedUser(
  authorization
) {

  if (
    !authorization ||
    !authorization.startsWith("Bearer ")
  ) {

    return null;

  }


  const accessToken =
    authorization
      .slice("Bearer ".length)
      .trim();


  if (!accessToken) {

    return null;

  }


  if (
    !SUPABASE_URL ||
    !SUPABASE_PUBLISHABLE_KEY
  ) {

    throw new Error(
      "Supabase environment variables are not configured"
    );

  }


  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",

        headers: {
          "apikey":
            SUPABASE_PUBLISHABLE_KEY,

          "Authorization":
            `Bearer ${accessToken}`
        }
      }
    );


  if (!response.ok) {

    return null;

  }


  const user =
    await response.json();


  if (!user?.id) {

    return null;

  }


  return user;
}


module.exports =
async function handler(req, res) {

  if (req.method !== "POST") {

    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });

  }


  try {

    /*
      =========================
      LOGIN CHECK
      =========================

      dashboard.htmlから送られてきた
      Supabase Access Tokenを使って、
      本当にログイン中のユーザーか確認する。

      未ログイン・偽造トークンの場合は
      Presigned URLを発行しない。
    */

    const user =
      await getAuthenticatedUser(
        req.headers.authorization
      );


    if (!user) {

      return res.status(401).json({
        ok: false,
        error: "Unauthorized"
      });

    }


    const {
      fileName,
      contentType,
      folder
    } = req.body || {};


    if (!fileName) {

      return res.status(400).json({
        ok: false,
        error: "fileName is required"
      });

    }


    const safeFileName =
      sanitizeFileName(fileName);


    if (!safeFileName) {

      return res.status(400).json({
        ok: false,
        error: "Invalid fileName"
      });

    }


    /*
      NovaRadioでは現状、
      フル音源と30秒ハイライトのみ
      Cloudflare R2へ保存する。
    */

    const allowedFolders = [
      "songs",
      "highlights"
    ];


    /*
      不正なfolderが来た場合は
      Presigned URLを発行しない。
    */

    if (
      !allowedFolders.includes(folder)
    ) {

      return res.status(400).json({
        ok: false,
        error: "Invalid folder"
      });

    }


    const safeContentType =
      String(
        contentType ||
        "application/octet-stream"
      );


    const allowedContentTypes = [
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav"
    ];


    if (
      !allowedContentTypes.includes(
        safeContentType
      )
    ) {

      return res.status(400).json({
        ok: false,
        error: "Unsupported content type"
      });

    }


    /*
      =========================
      USER OWNED R2 KEY
      =========================

      songs/USER_ID/日時-file.mp3

      highlights/USER_ID/日時-file.mp3

      R2上でもユーザーごとに
      保存先を分離する。
    */

    const key =
      `${folder}/${user.id}/${Date.now()}-${safeFileName}`;


    const command =
      new PutObjectCommand({
        Bucket:
          process.env.R2_BUCKET_NAME,

        Key:
          key,

        ContentType:
          safeContentType
      });


    /*
      Presigned URLは5分間だけ有効。

      音源本体はVercelを経由せず、
      ブラウザからCloudflare R2へ
      直接PUTする。
    */

    const uploadUrl =
      await getSignedUrl(
        s3,
        command,
        {
          expiresIn: 300
        }
      );


    return res.status(200).json({
      ok: true,

      key,

      uploadUrl,

      expiresIn: 300
    });

  }
  catch (error) {

    console.error(
      "R2 presign error:",
      error
    );


    return res.status(500).json({
      ok: false,

      error:
        error?.message ||
        "R2 presigned URL creation failed"
    });

  }

};
