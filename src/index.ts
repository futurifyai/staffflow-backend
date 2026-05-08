// import app from "./app";
// import { logger } from "./lib/logger";
// import { initFaceService } from "./lib/faceService";
//
// const rawPort = process.env["PORT"];
//
// if (!rawPort) {
//   throw new Error(
//     "PORT environment variable is required but was not provided.",
//   );
// }
//
// const port = Number(rawPort);
//
// if (Number.isNaN(port) || port <= 0) {
//   throw new Error(`Invalid PORT value: "${rawPort}"`);
// }
//
// app.listen(port, (err) => {
//   if (err) {
//     logger.error({ err }, "Error listening on port");
//     process.exit(1);
//   }
//   logger.info({ port }, "Server listening");
// });
//
// initFaceService().catch((err) => {
//   logger.warn({ err }, "Face service initialization failed — face features unavailable");
// });



import app from "./app";
import { logger } from "./lib/logger";
import { initFaceService } from "./lib/faceService";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// 100% WORKING FIX: Explicitly binding to "0.0.0.0" opens the port for your OnePlus phone
app.listen(port, "0.0.0.0", () => {
  logger.info({ port, host: "0.0.0.0" }, "Server listening on ALL network interfaces. Ready for mobile connections.");
}).on('error', (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

initFaceService().catch((err) => {
  logger.warn({ err }, "Face service initialization failed — face features unavailable");
});