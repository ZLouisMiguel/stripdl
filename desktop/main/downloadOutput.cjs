const { StringDecoder } = require("node:string_decoder");

function createLineDecoder(onLine) {
  let remainder = "";
  const utf8 = new StringDecoder("utf8");
  const emitCompleteLines = () => {
    let newline;
    while ((newline = remainder.indexOf("\n")) !== -1) {
      const line = remainder.slice(0, newline).replace(/\r$/, "");
      remainder = remainder.slice(newline + 1);
      if (line) onLine(line);
    }
  };

  const decode = (chunk) => {
    remainder += typeof chunk === "string" ? chunk : utf8.write(chunk);
    emitCompleteLines();
  };
  decode.end = () => {
    remainder += utf8.end();
    emitCompleteLines();
    const line = remainder.replace(/\r$/, "");
    remainder = "";
    if (line) onLine(line);
  };
  return decode;
}

function summarizeDownloadFailure(event, stderr = "", exitCode = 0) {
  const detail = event?.message || stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0];
  if (event?.status === "chapter_error") {
    const subject = event.chapter ? `Chapter ${event.chapter}` : "Chapter list";
    return `${subject} failed: ${detail || "the chapter could not be downloaded"}. Retry this download to fetch the missing pages.`;
  }
  if (event?.status === "partial") {
    return `${detail || "Some chapters could not be downloaded."} Retry this download to fetch the missing pages.`;
  }
  if (event?.status === "error" || exitCode !== 0) {
    const reason = detail || `stripdl exited with code ${exitCode}`;
    return `${reason}. Check your connection and retry the download.`;
  }
  return null;
}

module.exports = { createLineDecoder, summarizeDownloadFailure };
