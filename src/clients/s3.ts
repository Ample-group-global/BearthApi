import https from "https";
import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

let _client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (_client) return _client;
  const accessKeyId     = process.env.FILEBASE_ACCESS_KEY;
  const secretAccessKey = process.env.FILEBASE_SECRET_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error("FILEBASE_ACCESS_KEY and FILEBASE_SECRET_KEY must be set");
  _client = new S3Client({
    endpoint:       "https://s3.filebase.io",
    region:         "auto",
    credentials:    { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    // Default Node HTTP handler caps at 50 sockets — a full-collection
    // export/preview/download batch can legitimately burst well past that
    // (confirmed live: 136 requests queued behind the cap), stalling jobs
    // for no real reason since Filebase itself isn't the bottleneck.
    requestHandler: new NodeHttpHandler({ httpsAgent: new https.Agent({ maxSockets: 200 }) }),
  });
  return _client;
}
