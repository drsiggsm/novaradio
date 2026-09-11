const {
  S3Client,
  PutObjectCommand
} = require("@aws-sdk/client-s3");

const {
  getSignedUrl
} = require("@aws-sdk/s3-request-presigner");

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

function sanitizeFileName(fileName) {
  const name = String(fileName || "")
    .split("/")
    .pop()
    .split("\\")
    .pop();

  return name.replace(
    /[^a-zA-Z0-9._-]/g,
    "_"
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
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
      フル音源と30秒ハイライトのみR2へ保存する。
    */
    const allowedFolders = [
      "songs",
      "highlights"
    ];

    const safeFolder =
      allowedFolders.includes(folder)
        ? folder
        : "songs";

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

    const key =
      `${safeFolder}/${Date.now()}-${safeFileName}`;

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
      URLは5分間だけ有効。
      ブラウザはこのURLへ直接PUTするため、
      大きい音源をVercel本体へ通さずに済む。
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
