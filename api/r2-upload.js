const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { fileName, contentType } = req.body || {};

    if (!fileName) {
      return res.status(400).json({ error: "fileName is required" });
    }

    const key = `songs/${Date.now()}-${fileName}`;

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType || "audio/mpeg",
      Body: Buffer.from("NovaRadio R2 connection test"),
    });

    await s3.send(command);

    return res.status(200).json({
      ok: true,
      key,
      message: "R2 upload test succeeded",
    });
  } catch (error) {
    console.error("R2 upload error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
};
