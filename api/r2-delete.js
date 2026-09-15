const {
  S3Client,
  DeleteObjectCommand
} = require("@aws-sdk/client-s3");

function normalizeEndpoint(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/novaradio-audio$/, "");
}

const s3 = new S3Client({
  region: "auto",
  endpoint: normalizeEndpoint(
    process.env.R2_ENDPOINT
  ),
  credentials: {
    accessKeyId:
      process.env.R2_ACCESS_KEY_ID,
    secretAccessKey:
      process.env.R2_SECRET_ACCESS_KEY
  },
  forcePathStyle: true
});

module.exports = async function handler(
  req,
  res
) {

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {

    const {
      key
    } = req.body || {};

    if (
      !key ||
      typeof key !== "string"
    ) {
      return res.status(400).json({
        ok: false,
        error: "key is required"
      });
    }

    /*
      NovaRadioの音源フォルダ以外は
      このAPIから削除できないようにする。
    */
    if (
      !key.startsWith("songs/") &&
      !key.startsWith("highlights/")
    ) {
      return res.status(400).json({
        ok: false,
        error: "Invalid R2 key"
      });
    }

    await s3.send(
      new DeleteObjectCommand({
        Bucket:
          process.env.R2_BUCKET_NAME,
        Key: key
      })
    );

    return res.status(200).json({
      ok: true,
      key
    });

  }
  catch (error) {

    console.error(
      "R2 delete error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "R2 delete failed"
    });

  }

};
