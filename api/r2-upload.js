const {
  S3Client,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,

  // Cloudflare R2ではpath-styleでアクセスする
  // これがないと
  // novaradio-audio.xxxxx.r2.cloudflarestorage.com
  // のような存在しないホストへ接続しようとする場合がある
  forcePathStyle: true,

  credentials: {
    accessKeyId:
      process.env.R2_ACCESS_KEY_ID,

    secretAccessKey:
      process.env.R2_SECRET_ACCESS_KEY,
  },
});


module.exports = async function handler(
  req,
  res
) {

  if (req.method !== "POST") {

    return res
      .status(405)
      .json({
        ok: false,
        error: "Method not allowed",
      });

  }


  try {

    const {
      fileName,
      contentType,
    } = req.body || {};


    if (!fileName) {

      return res
        .status(400)
        .json({
          ok: false,
          error: "fileName is required",
        });

    }


    /*
      今はR2接続確認用。

      本物の音源アップロードは
      次の段階で実装する。

      songs/
        1720000000000-test.txt

      のような形で保存される。
    */
    const safeFileName =
      String(fileName)
        .replace(
          /[^a-zA-Z0-9._-]/g,
          "_"
        );


    const key =
      `songs/${Date.now()}-${safeFileName}`;


    const command =
      new PutObjectCommand({

        Bucket:
          process.env.R2_BUCKET_NAME,

        Key:
          key,

        ContentType:
          contentType ||
          "application/octet-stream",

        Body:
          Buffer.from(
            "NovaRadio R2 connection test",
            "utf8"
          ),

      });


    await s3.send(
      command
    );


    return res
      .status(200)
      .json({

        ok: true,

        key:
          key,

        message:
          "R2 upload test succeeded",

      });


  } catch (error) {

    console.error(
      "R2 upload error:",
      error
    );


    return res
      .status(500)
      .json({

        ok: false,

        error:
          error?.message ||
          "Unknown R2 upload error",

      });

  }

};
