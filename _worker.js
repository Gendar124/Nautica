import { connect } from "cloudflare:sockets";


/* =======================
   CONFIG
   ======================= */
// @last_masterX
const serviceName = "@last_masterX";

let prxIP = "";
const PRX_HEALTH_CHECK_API = "https://id1.foolvpn.me/api/v1/check";

// ENCODE BASE64 VLS BIAR GA 1101//
const horse = "dHJvamFu";
const v2 = "djJyYXk=";
const neko = "Y2xhc2g=";
const flash = "dmxlc3M=";
const judul= "VkxFU1M=";

const PRX_BANK_BASE =
  "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/proxyList.txt";

const DNS_SERVER_ADDRESS = "8.8.8.8";
const DNS_SERVER_PORT = 53;

const RELAY_SERVER_UDP = {
  host: "udp-relay.hobihaus.space",
  port: 7300,
};

const PORTS = [443, 80];
const PROTOCOLS = [atob(horse), atob(flash), "ss"];

const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;

const CORS_HEADER_OPTIONS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

let trafficStats = null;
let cachedPrxList = {}; 


async function loadTrafficStats(env) {
  if (trafficStats) return trafficStats;
  
  try {
    if (env && env.traffic_stats) {
      const raw = await env.traffic_stats.get("trafficStats");
      if (raw) {
        const parsed = JSON.parse(raw);
        parsed.uniqueVisitors = new Set(parsed.uniqueVisitors || []);
        trafficStats = parsed;
      }
    }
  } catch (e) {
    console.error("Error loading traffic stats:", e);
  }
  
  if (!trafficStats) {
    trafficStats = {
      totalVisitors: 0,
      uniqueVisitors: new Set(),
      bandwidthUsed: 0,
      todayVisitors: 0,
      todayBandwidth: 0,
      lastReset: new Date().toISOString().split('T')[0]
    };
    await saveTrafficStats(env);
  }
  return trafficStats;
}

async function saveTrafficStats(env) {
  if (!trafficStats || !env || !env.traffic_stats) return;
  
  try {
    const serializable = {
      ...trafficStats,
      uniqueVisitors: Array.from(trafficStats.uniqueVisitors)
    };
    await env.traffic_stats.put("trafficStats", JSON.stringify(serializable));
  } catch (e) {
    console.error("Error saving traffic stats:", e);
  }
}

function getVisitorId(request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';
  const accept = request.headers.get('accept') || 'unknown';
  
  const data = ip + userAgent + accept;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

async function updateTrafficStats(request, responseSize = 0, env) {
  try {
    await loadTrafficStats(env);
    const visitorId = getVisitorId(request);
    const today = new Date().toISOString().split('T')[0];

    if (trafficStats.lastReset !== today) {
      trafficStats.todayVisitors = 0;
      trafficStats.todayBandwidth = 0;
      trafficStats.lastReset = today;
      trafficStats.uniqueVisitors = new Set();
    }

    if (!trafficStats.uniqueVisitors.has(visitorId)) {
      trafficStats.uniqueVisitors.add(visitorId);
      trafficStats.totalVisitors++;
      trafficStats.todayVisitors++;
    }

    trafficStats.bandwidthUsed += responseSize;
    trafficStats.todayBandwidth += responseSize;

    await saveTrafficStats(env);
  } catch (error) {
    console.error("Error updating traffic stats:", error);
  }
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/* =======================
   UTIL: Fetch proxy list file and parse
   ======================= */
async function getPrx(countryCode = "ALL") {
  const code = (countryCode || "ALL").toUpperCase();
  if (cachedPrxList[code]) return cachedPrxList[code];

  const url = `${PRX_BANK_BASE}/${code}.txt`;
  try {
    const res = await fetch(url);
    if (res.status !== 200) {
      if (code !== "ALL") {
        return getPrx("ALL");
      }
      return [];
    }
    const text = await res.text();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const parsed = lines.map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      return {
        prxIP: parts[0] || "Unknown",
        prxPort: parts[1] || "443",
        country: parts[2] || code,
        org: parts[3] || "Unknown Org",
        raw: line,
      };
    });
    cachedPrxList[code] = parsed;
    return parsed;
  } catch (e) {
    return [];
  }
}

/* =======================
   HELPERS
   ======================= */
async function websocketHandler(request) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);

  webSocket.accept();

  let addressLog = "";
  let portLog = "";
  const log = (info, event) => {
    console.log(`[${addressLog}:${portLog}] ${info}`, event || "");
  };
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";

  const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

  let remoteSocketWrapper = {
    value: null,
  };
  let isDNS = false;

  readableWebSocketStream
    .pipeTo(
      new WritableStream({
        async write(chunk, controller) {
          if (isDNS) {
            return handleUDPOutbound(
              DNS_SERVER_ADDRESS,
              DNS_SERVER_PORT,
              chunk,
              webSocket,
              null,
              log,
              RELAY_SERVER_UDP
            );
          }
          if (remoteSocketWrapper.value) {
            const writer = remoteSocketWrapper.value.writable.getWriter();
            await writer.write(chunk);
            writer.releaseLock();
            return;
          }

          const protocol = await protocolSniffer(chunk);
          let protocolHeader;

          if (protocol === atob(horse)) {
            protocolHeader = readHorseHeader(chunk);
          } else if (protocol === atob(flash)) {
            protocolHeader = readFlashHeader(chunk);
          } else if (protocol === "ss") {
            protocolHeader = readSsHeader(chunk);
          } else {
            throw new Error("Unknown Protocol!");
          }

          addressLog = protocolHeader.addressRemote;
          portLog = `${protocolHeader.portRemote} -> ${protocolHeader.isUDP ? "UDP" : "TCP"}`;

          if (protocolHeader.hasError) {
            throw new Error(protocolHeader.message);
          }

          if (protocolHeader.isUDP) {
            if (protocolHeader.portRemote === 53) {
              isDNS = true;
              return handleUDPOutbound(
                DNS_SERVER_ADDRESS,
                DNS_SERVER_PORT,
                chunk,
                webSocket,
                protocolHeader.version,
                log,
                RELAY_SERVER_UDP
              );
            }

            return handleUDPOutbound(
              protocolHeader.addressRemote,
              protocolHeader.portRemote,
              chunk,
              webSocket,
              protocolHeader.version,
              log,
              RELAY_SERVER_UDP
            );
          }

          handleTCPOutBound(
            remoteSocketWrapper,
            protocolHeader.addressRemote,
            protocolHeader.portRemote,
            protocolHeader.rawClientData,
            webSocket,
            protocolHeader.version,
            log
          );
        },
        close() {
          log(`readableWebSocketStream is close`);
        },
        abort(reason) {
          log(`readableWebSocketStream is abort`, JSON.stringify(reason));
        },
      })
    )
    .catch((err) => {
      log("readableWebSocketStream pipeTo error", err);
    });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

async function protocolSniffer(buffer) {
  if (buffer.byteLength >= 62) {
    const horseDelimiter = new Uint8Array(buffer.slice(56, 60));
    if (horseDelimiter[0] === 0x0d && horseDelimiter[1] === 0x0a) {
      if (horseDelimiter[2] === 0x01 || horseDelimiter[2] === 0x03 || horseDelimiter[2] === 0x7f) {
        if (horseDelimiter[3] === 0x01 || horseDelimiter[3] === 0x03 || horseDelimiter[3] === 0x04) {
          return atob(horse);
        }
      }
    }
  }

  const flashDelimiter = new Uint8Array(buffer.slice(1, 17));
  // Hanya mendukung UUID v4
  if (arrayBufferToHex(flashDelimiter).match(/^[0-9a-f]{8}[0-9a-f]{4}4[0-9a-f]{3}[89ab][0-9a-f]{3}[0-9a-f]{12}$/i)) {
    return atob(flash);
  }

  return "ss"; // default
}

async function handleTCPOutBound(
  remoteSocket,
  addressRemote,
  portRemote,
  rawClientData,
  webSocket,
  responseHeader,
  log
) {
  async function connectAndWrite(address, port) {
    const tcpSocket = connect({
      hostname: address,
      port: port,
    });
    remoteSocket.value = tcpSocket;
    log(`connected to ${address}:${port}`);
    const writer = tcpSocket.writable.getWriter();
    await writer.write(rawClientData);
    writer.releaseLock();

    return tcpSocket;
  }

  async function retry() {
    const tcpSocket = await connectAndWrite(
      prxIP.split(/[:=-]/)[0] || addressRemote,
      prxIP.split(/[:=-]/)[1] || portRemote
    );
    tcpSocket.closed
      .catch((error) => {
        console.log("retry tcpSocket closed error", error);
      })
      .finally(() => {
        safeCloseWebSocket(webSocket);
      });
    remoteSocketToWS(tcpSocket, webSocket, responseHeader, null, log);
  }

  const tcpSocket = await connectAndWrite(addressRemote, portRemote);

  remoteSocketToWS(tcpSocket, webSocket, responseHeader, retry, log);
}

async function handleUDPOutbound(targetAddress, targetPort, dataChunk, webSocket, responseHeader, log, relay) {
  try {
    let protocolHeader = responseHeader;

    const tcpSocket = connect({
      hostname: relay.host,
      port: relay.port,
    });

    const header = `udp:${targetAddress}:${targetPort}`;
    const headerBuffer = new TextEncoder().encode(header);
    const separator = new Uint8Array([0x7c]);
    const relayMessage = new Uint8Array(headerBuffer.length + separator.length + dataChunk.byteLength);
    relayMessage.set(headerBuffer, 0);
    relayMessage.set(separator, headerBuffer.length);
    relayMessage.set(new Uint8Array(dataChunk), headerBuffer.length + separator.length);

    const writer = tcpSocket.writable.getWriter();
    await writer.write(relayMessage);
    writer.releaseLock();

    await tcpSocket.readable.pipeTo(
      new WritableStream({
        async write(chunk) {
          if (webSocket.readyState === WS_READY_STATE_OPEN) {
            if (protocolHeader) {
              webSocket.send(await new Blob([protocolHeader, chunk]).arrayBuffer());
              protocolHeader = null;
            } else {
              webSocket.send(chunk);
            }
          }
        },
        close() {
          log(`UDP connection to ${targetAddress} closed`);
        },
        abort(reason) {
          console.error(`UDP connection aborted due to ${reason}`);
        },
      })
    );
  } catch (e) {
    console.error(`Error while handling UDP outbound: ${e.message}`);
  }
}

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
  let readableStreamCancel = false;
  const stream = new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener("message", (event) => {
        if (readableStreamCancel) {
          return;
        }
        const message = event.data;
        controller.enqueue(message);
      });
      webSocketServer.addEventListener("close", () => {
        safeCloseWebSocket(webSocketServer);
        if (readableStreamCancel) {
          return;
        }
        controller.close();
      });
      webSocketServer.addEventListener("error", (err) => {
        log("webSocketServer has error");
        controller.error(err);
      });
      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) {
        controller.error(error);
      } else if (earlyData) {
        controller.enqueue(earlyData);
      }
    },

    pull(controller) {},
    cancel(reason) {
      if (readableStreamCancel) {
        return;
      }
      log(`ReadableStream was canceled, due to ${reason}`);
      readableStreamCancel = true;
      safeCloseWebSocket(webSocketServer);
    },
  });

  return stream;
}

function readSsHeader(ssBuffer) {
  const view = new DataView(ssBuffer);

  const addressType = view.getUint8(0);
  let addressLength = 0;
  let addressValueIndex = 1;
  let addressValue = "";

  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 3:
      addressLength = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 4:
      addressLength = 16;
      const dataView = new DataView(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `Invalid addressType for SS: ${addressType}`,
      };
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `Destination address empty, address type is: ${addressType}`,
    };
  }

  const portIndex = addressValueIndex + addressLength;
  const portBuffer = ssBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: portIndex + 2,
    rawClientData: ssBuffer.slice(portIndex + 2),
    version: null,
    isUDP: portRemote == 53,
  };
}

function readFlashHeader(buffer) {
  const version = new Uint8Array(buffer.slice(0, 1));
  let isUDP = false;

  const optLength = new Uint8Array(buffer.slice(17, 18))[0];

  const cmd = new Uint8Array(buffer.slice(18 + optLength, 18 + optLength + 1))[0];
  if (cmd === 1) {
  } else if (cmd === 2) {
    isUDP = true;
  } else {
    return {
      hasError: true,
      message: `command ${cmd} is not supported`,
    };
  }
  const portIndex = 18 + optLength + 1;
  const portBuffer = buffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);

  let addressIndex = portIndex + 2;
  const addressBuffer = new Uint8Array(buffer.slice(addressIndex, addressIndex + 1));

  const addressType = addressBuffer[0];
  let addressLength = 0;
  let addressValueIndex = addressIndex + 1;
  let addressValue = "";
  switch (addressType) {
    case 1: // For IPv4
      addressLength = 4;
      addressValue = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 2: // For Domain
      addressLength = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(buffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 3: // For IPv6
      addressLength = 16;
      const dataView = new DataView(buffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `invild  addressType is ${addressType}`,
      };
  }
  if (!addressValue) {
    return {
      hasError: true,
      message: `addressValue is empty, addressType is ${addressType}`,
    };
  }

  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: addressValueIndex + addressLength,
    rawClientData: buffer.slice(addressValueIndex + addressLength),
    version: new Uint8Array([version[0], 0]),
    isUDP: isUDP,
  };
}

function readHorseHeader(buffer) {
  const dataBuffer = buffer.slice(58);
  if (dataBuffer.byteLength < 6) {
    return {
      hasError: true,
      message: "invalid request data",
    };
  }

  let isUDP = false;
  const view = new DataView(dataBuffer);
  const cmd = view.getUint8(0);
  if (cmd == 3) {
    isUDP = true;
  } else if (cmd != 1) {
    throw new Error("Unsupported command type!");
  }

  let addressType = view.getUint8(1);
  let addressLength = 0;
  let addressValueIndex = 2;
  let addressValue = "";
  switch (addressType) {
    case 1: // For IPv4
      addressLength = 4;
      addressValue = new Uint8Array(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 3: // For Domain
      addressLength = new Uint8Array(dataBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 4: // For IPv6
      addressLength = 16;
      const dataView = new DataView(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `invalid addressType is ${addressType}`,
      };
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `address is empty, addressType is ${addressType}`,
    };
  }

  const portIndex = addressValueIndex + addressLength;
  const portBuffer = dataBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: portIndex + 4,
    rawClientData: dataBuffer.slice(portIndex + 4),
    version: null,
    isUDP: isUDP,
  };
}

async function remoteSocketToWS(remoteSocket, webSocket, responseHeader, retry, log) {
  let header = responseHeader;
  let hasIncomingData = false;
  await remoteSocket.readable
    .pipeTo(
      new WritableStream({
        start() {},
        async write(chunk, controller) {
          hasIncomingData = true;
          if (webSocket.readyState !== WS_READY_STATE_OPEN) {
            controller.error("webSocket.readyState is not open, maybe close");
          }
          if (header) {
            webSocket.send(await new Blob([header, chunk]).arrayBuffer());
            header = null;
          } else {
            webSocket.send(chunk);
          }
        },
        close() {
          log(`remoteConnection!.readable is close with hasIncomingData is ${hasIncomingData}`);
        },
        abort(reason) {
          console.error(`remoteConnection!.readable abort`, reason);
        },
      })
    )
    .catch((error) => {
      console.error(`remoteSocketToWS has exception `, error.stack || error);
      safeCloseWebSocket(webSocket);
    });
  if (hasIncomingData === false && retry) {
    log(`retry`);
    retry();
  }
}

function safeCloseWebSocket(socket) {
  try {
    if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
      socket.close();
    }
  } catch (error) {
    console.error("safeCloseWebSocket error", error);
  }
}

// Helpers
function base64ToArrayBuffer(base64Str) {
  if (!base64Str) {
    return { error: null };
  }
  try {
    base64Str = base64Str.replace(/-/g, "+").replace(/_/g, "/");
    const decode = atob(base64Str);
    const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
    return { earlyData: arryBuffer.buffer, error: null };
  } catch (error) {
    return { error };
  }
}

function arrayBufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function shuffleArray(array) {
  let currentIndex = array.length;

  // While there remain elements to shuffle...
  while (currentIndex != 0) {
    // Pick a remaining element...
    let randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
}

/* =======================
   PROXY / SUB GENERATOR dengan path ip-port
   ======================= */
async function generateSubscription(params, request) {
  const domainParam = params.domain || "bug.com";
  const customIP = params.ip || null;
  const customPort = params.port || null;

  const fillerHost = (request && request.headers.get("Host")) ;

  let prx;
  if (customIP && customPort) {
    prx = {
      prxIP: customIP,
      prxPort: customPort,
      country: "CUSTOM",
      org: "Custom Proxy"
    };
  } else {
    /* menambahkan opsi negara, bisa di-uncomment
    const sgList = await getPrx("SG");
    const idList = await getPrx("ID");
    const inList = await getPrx("IN");
    const prxList = [...sgList, ...idList, ...inList];
    */
    const prxList = await getPrx();
    if (!prxList.length) return JSON.stringify({ error: "No proxy available" });

    prx = prxList[Math.floor(Math.random() * prxList.length)];
  }

  const uuid = crypto.randomUUID();

  const config_vls = {
    [atob(flash)]: (() => {
      const uri = new URL(`${atob(flash)}://${domainParam}`);
      uri.searchParams.set("encryption", "none");
      uri.searchParams.set("type", "ws");
      uri.searchParams.set("host", fillerHost);  
      uri.protocol = atob(flash);
      uri.port = "443";
      uri.username = uuid;
      uri.searchParams.set("security", "tls");
      uri.searchParams.set("sni", fillerHost);  
      // Path dengan format ip-port
      uri.searchParams.set("path", `/${prx.prxIP}-${prx.prxPort}`);
      uri.hash = `${prx.org} WS TLS [${serviceName}]`;
      return uri.toString();
    })()
  };

  return JSON.stringify({
    uuid,
    ip: prx.prxIP,
    port: prx.prxPort,
    org: prx.org,
    config_vls
  }, null, 2);
}

/* =======================
   Reverse Web / Basic Proxy
   ======================= */
async function reverseWeb(request, target, targetPath, env, ctx) {
  const targetUrl = new URL(request.url);
  const targetChunk = (target || "example.com").split(":");

  targetUrl.hostname = targetChunk[0];
  targetUrl.port = targetChunk[1]?.toString() || "443";
  targetUrl.pathname = targetPath || targetUrl.pathname;

  const modifiedRequest = new Request(targetUrl, request);
  modifiedRequest.headers.set("X-Forwarded-Host", request.headers.get("Host") || "");
  const response = await fetch(modifiedRequest);
  
  const contentLength = response.headers.get('content-length');
  let responseSize = contentLength ? parseInt(contentLength) : 0;
  
  if (!responseSize) {
    try {
      const clone = response.clone();
      const body = await clone.text();
      responseSize = new TextEncoder().encode(body).length;
    } catch (_) {
      responseSize = 0;
    }
  }

  const newResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(CORS_HEADER_OPTIONS)) {
    newResponse.headers.set(key, value);
  }
  newResponse.headers.set("X-Proxied-By", "Worker");
  
  if (env && ctx) {
    ctx.waitUntil(updateTrafficStats(request, responseSize, env));
  }
  
  return newResponse;
}





/* =======================
   SERVE UI FUNCTION DENGAN SEMUA EFEK BARU
   ======================= */


function serveUI() {
  const decodedJudul = atob(judul);
  const decodedFlash = atob(flash);
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${decodedJudul} Worker - Modern Proxy Dashboard</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { 
      margin: 0; 
      padding: 0; 
      box-sizing: border-box; 
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; 
    }
    
    :root {
      --primary: #6366f1;
      --primary-dark: #4f46e5;
      --primary-light: #8b5cf6;
      --secondary: #06b6d4;
      --accent: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
      --dark: #0f172a;
      --darker: #020617;
      --light: #f8fafc;
      --gray: #64748b;
      --gray-light: #cbd5e1;
      --glass: rgba(255, 255, 255, 0.03);
      --glass-border: rgba(255, 255, 255, 0.08);
      --glass-hover: rgba(255, 255, 255, 0.05);
    }
    
    body {
      background: linear-gradient(rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95)), 
                  url('https://img.wattpad.com/63b4fef6d4a8b5eef3a12394990aea164cfe4be1/68747470733a2f2f73332e616d617a6f6e6177732e636f6d2f776174747061642d6d656469612d736572766963652f53746f7279496d6167652f4349516e4f5962596f476f5241773d3d2d3132302e313563323538386461323838623263313733313931313130373332332e6a7067?s=fit&w=720&h=720') no-repeat center center fixed;
      background-size: cover;
      color: var(--light);
      min-height: 100vh;
      line-height: 1.6;
      overflow-x: hidden;
    }
    
    .bg-animation {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: -1;
      opacity: 0.3;
    }
    
    .bg-particle {
      position: absolute;
      background: radial-gradient(circle, var(--primary-light) 0%, transparent 70%);
      border-radius: 50%;
      animation: float 20s infinite linear;
    }
    
    @keyframes float {
      0%, 100% { transform: translate(0, 0) scale(1); }
      25% { transform: translate(100px, 100px) scale(1.2); }
      50% { transform: translate(200px, 50px) scale(0.8); }
      75% { transform: translate(50px, 200px) scale(1.1); }
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
      position: relative;
      z-index: 1;
    }
    
    /* Running Text */
    .running-text-container {
      background: rgba(0, 0, 0, 0.7);
      border-radius: 10px;
      padding: 12px;
      margin: 10px 0 30px 0;
      border: 1px solid rgba(255, 255, 255, 0.2);
      overflow: hidden;
      position: relative;
      backdrop-filter: blur(10px);
    }

    .running-text {
      white-space: nowrap;
      color: #ff00ff;
      font-weight: 700;
      font-size: 1.3rem;
      text-shadow: 0 0 10px #ff00ff, 0 0 20px #ff00ff, 0 0 30px #ff00ff;
      animation: runText 15s linear infinite;
      text-align: center;
      padding: 5px 0;
    }

    @keyframes runText {
      0% { transform: translateX(100%); }
      100% { transform: translateX(-100%); }
    }
    
    /* Header Modern */
    .header {
      text-align: center;
      margin-bottom: 40px;
      padding: 40px 30px;
      background: linear-gradient(135deg, var(--glass) 0%, rgba(99, 102, 241, 0.08) 100%);
      border-radius: 24px;
      backdrop-filter: blur(20px);
      border: 1px solid var(--glass-border);
      position: relative;
      overflow: hidden;
    }
    
    /* Garis Api untuk Header */
    .header::before {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 3px;
      background: linear-gradient(90deg, transparent, #ff0000, #ff5500, #ffff00, #ff5500, #ff0000, transparent);
      animation: fireLine 3s infinite;
      filter: blur(1px);
      z-index: 2;
    }
    
    .header::after {
      content: '';
      position: absolute;
      bottom: 0;
      right: -100%;
      width: 100%;
      height: 3px;
      background: linear-gradient(90deg, transparent, #00ffff, #00aaff, #0055ff, #00aaff, #00ffff, transparent);
      animation: fireLine 4s infinite reverse;
      filter: blur(1px);
      z-index: 2;
    }
    
    .header:hover::before {
      left: 100%;
    }
    
    .logo {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      margin-bottom: 20px;
    }
    
    .logo-icon {
      width: 60px;
      height: 60px;
      background: linear-gradient(135deg, var(--primary), var(--primary-light));
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      color: white;
      box-shadow: 0 8px 32px rgba(99, 102, 241, 0.3);
    }
    
    .header h1 {
      font-size: 3rem;
      font-weight: 700;
      background: linear-gradient(135deg, #fff 0%, var(--secondary) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 12px;
    }
    
    .header p {
      font-size: 1.2rem;
      color: var(--gray-light);
      max-width: 600px;
      margin: 0 auto 25px;
      font-weight: 400;
    }
    
    /* Badge Modern */
    .badge-container {
      display: flex;
      justify-content: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    
    .badge {
      background: linear-gradient(135deg, var(--glass) 0%, var(--glass-hover) 100%);
      color: var(--light);
      padding: 10px 20px;
      border-radius: 50px;
      font-size: 0.85rem;
      font-weight: 500;
      border: 1px solid var(--glass-border);
      backdrop-filter: blur(10px);
      transition: all 0.3s ease;
    }
    
    .badge:hover {
      transform: translateY(-2px);
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
      box-shadow: 0 8px 25px rgba(99, 102, 241, 0.3);
    }
    
    /* Dashboard Grid Modern */
    .dashboard {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
      gap: 25px;
      margin-bottom: 50px;
    }
    
    /* Card Modern dengan Efek Api dan Transparan */
    .card {
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.02) 0%, rgba(99, 102, 241, 0.03) 100%);
      border-radius: 20px;
      padding: 30px;
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.05);
      transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      position: relative;
      overflow: hidden;
    }
    
    /* Garis Api Merah - Kiri ke Kanan */
    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 2px;
      background: linear-gradient(90deg, transparent, #ff0000, #ff5500, #ff0000, transparent);
      animation: fireLine 3s ease-in-out infinite;
      filter: blur(1px);
      z-index: 2;
    }
    
    /* Garis Api Biru - Kanan ke Kiri */
    .card::after {
      content: '';
      position: absolute;
      bottom: 0;
      right: -100%;
      width: 100%;
      height: 2px;
      background: linear-gradient(90deg, transparent, #00ffff, #00aaff, #00ffff, transparent);
      animation: fireLine 4s ease-in-out infinite reverse;
      filter: blur(1px);
      z-index: 2;
    }
    
    @keyframes fireLine {
      0% { 
        left: -100%;
        opacity: 0;
      }
      50% { 
        opacity: 1;
      }
      100% { 
        left: 100%;
        opacity: 0;
      }
    }
    
    .card:hover {
      transform: translateY(-8px);
      border-color: rgba(99, 102, 241, 0.3);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
    }
    
    .card-header {
      display: flex;
      align-items: center;
      margin-bottom: 25px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--glass-border);
    }
    
    .card-icon {
      width: 50px;
      height: 50px;
      background: linear-gradient(135deg, var(--primary), var(--primary-light));
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 15px;
      font-size: 20px;
      color: white;
    }
    
    .card-header h3 {
      font-size: 1.4rem;
      font-weight: 600;
      color: var(--light);
    }
    
    /* Info Grid Modern */
    .info-grid {
      display: grid;
      gap: 18px;
    }
    
    .info-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 15px;
      background: var(--glass);
      border-radius: 12px;
      border: 1px solid var(--glass-border);
      transition: all 0.3s ease;
    }
    
    .info-item:hover {
      background: var(--glass-hover);
      transform: translateX(5px);
    }
    
    .info-label {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 500;
      color: var(--gray-light);
    }
    
    .info-label i {
      color: var(--primary);
      width: 20px;
    }
    
    .info-value {
      font-weight: 600;
      font-family: 'Courier New', monospace;
      color: var(--light);
    }
    
    /* Input Modern */
    .input-group {
      display: flex;
      gap: 12px;
      margin-bottom: 15px;
    }
    
    .modern-input {
      flex: 1;
      padding: 14px 18px;
      border-radius: 12px;
      border: 1px solid var(--glass-border);
      background: var(--glass);
      color: var(--light);
      font-size: 14px;
      transition: all 0.3s ease;
    }
    
    .modern-input:focus {
      outline: none;
      border-color: var(--primary);
      background: var(--glass-hover);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
    }
    
    .modern-input::placeholder {
      color: var(--gray);
    }
    
    /* Button Modern */
    .btn {
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
      color: white;
      border: none;
      padding: 14px 24px;
      border-radius: 12px;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
    }
    
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(99, 102, 241, 0.4);
    }
    
    .btn-secondary {
      background: linear-gradient(135deg, var(--secondary) 0%, #0ea5e9 100%);
    }
    
    .btn-success {
      background: linear-gradient(135deg, var(--accent) 0%, #34d399 100%);
    }
    
    .btn-danger {
      background: linear-gradient(135deg, var(--danger) 0%, #f87171 100%);
    }
    
    .btn-outline {
      background: transparent;
      border: 1px solid var(--glass-border);
      color: var(--gray-light);
    }
    
    .btn-outline:hover {
      background: var(--glass-hover);
      border-color: var(--primary);
      color: var(--light);
    }
    
    /* Actions Grid */
    .actions {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-top: 20px;
    }
    
    /* Config Box Modern */
    .config-box {
      background: var(--glass);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      padding: 20px;
      margin: 20px 0;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      color: var(--gray-light);
      max-height: 120px;
      overflow-y: auto;
      transition: all 0.3s ease;
    }
    
    .config-box:hover {
      border-color: var(--primary);
    }
    
    /* Progress Bar Modern */
    .progress-bar {
      width: 100%;
      height: 6px;
      background: var(--glass);
      border-radius: 3px;
      overflow: hidden;
      margin: 15px 0;
    }
    
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--primary), var(--primary-light));
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    
    /* Digital Clock Modern */
    .digital-clock {
      margin: 30px 0;
    }
    
    .clock-container {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
    }
    
    .time-zone {
      background: linear-gradient(135deg, var(--glass) 0%, rgba(6, 182, 212, 0.1) 100%);
      padding: 20px;
      border-radius: 16px;
      text-align: center;
      border: 1px solid var(--glass-border);
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }
    
    /* Garis Api untuk Time Zone */
    .time-zone::before {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 2px;
      background: linear-gradient(90deg, transparent, #ff00ff, #fc00ff, #ff00ff, transparent);
      animation: fireLine 5s ease-in-out infinite;
      filter: blur(1px);
    }
    
    .time-zone:hover {
      transform: translateY(-5px);
      border-color: var(--secondary);
    }
    
    .time-label {
      font-size: 0.8rem;
      color: var(--gray-light);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 1px;
      font-weight: 600;
    }
    
    .time-value {
      font-size: 1.4rem;
      font-weight: 700;
      color: var(--secondary);
      font-family: 'Courier New', monospace;
      text-shadow: 0 0 20px rgba(6, 182, 212, 0.5);
    }
    
    /* Footer dengan Efek Meteor */
    .footer {
      text-align: center;
      margin-top: 60px;
      padding: 30px;
      background: linear-gradient(135deg, var(--glass) 0%, rgba(99, 102, 241, 0.05) 100%);
      border-radius: 20px;
      backdrop-filter: blur(20px);
      border: 1px solid var(--glass-border);
      position: relative;
      overflow: hidden;
    }
    
    /* Efek Meteor untuk Footer */
    .footer::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: 
        radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.1) 0%, transparent 50%),
        radial-gradient(circle at 70% 70%, rgba(255, 255, 255, 0.05) 0%, transparent 50%);
      animation: meteorShower 20s linear infinite;
      pointer-events: none;
    }
    
    @keyframes meteorShower {
      0% { transform: translateY(-100%) rotate(0deg); }
      100% { transform: translateY(100%) rotate(360deg); }
    }
    
    .footer p {
      color: var(--gray-light);
      margin-bottom: 15px;
    }
    
    /* Credit Menyala Terang */
    .credit {
      margin-top: 20px;
      position: relative;
      z-index: 2;
    }
    
    .credit p {
      font-size: 1.1rem;
      font-weight: 600;
      color: #ffffff;
      text-shadow: 
        0 0 10px #00ffff,
        0 0 20px #00ffff,
        0 0 30px #00ffff,
        0 0 40px #00ffff;
      animation: creditGlow 2s ease-in-out infinite alternate;
    }
    
    @keyframes creditGlow {
      from {
        text-shadow: 
          0 0 10px #00ffff,
          0 0 20px #00ffff,
          0 0 30px #00ffff;
      }
      to {
        text-shadow: 
          0 0 15px #00ffff,
          0 0 25px #00ffff,
          0 0 35px #00ffff,
          0 0 45px #00ffff;
      }
    }
    
    .credit a {
      color: #00ffff;
      text-decoration: none;
      font-weight: 700;
      text-shadow: 0 0 10px rgba(0, 255, 255, 0.8);
      transition: all 0.3s ease;
    }
    
    .credit a:hover {
      color: #ff00ff;
      text-shadow: 0 0 15px rgba(255, 0, 255, 0.8);
    }
    
    /* Popup dengan Efek Kaca Retak dan Petir */
    .popup-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.9);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 9999;
      backdrop-filter: blur(10px);
    }
    
    .popup-container {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      padding: 40px;
      border-radius: 20px;
      text-align: center;
      border: 2px solid #00ffff;
      box-shadow: 
        0 0 50px rgba(0, 255, 255, 0.5),
        inset 0 0 50px rgba(0, 255, 255, 0.1);
      max-width: 500px;
      width: 90%;
      position: relative;
      overflow: hidden;
    }
    
    /* Efek Kaca Retak */
    .popup-container::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-image: 
        radial-gradient(circle at 20% 30%, transparent 20%, rgba(255, 255, 255, 0.1) 25%, transparent 30%),
        radial-gradient(circle at 80% 70%, transparent 15%, rgba(255, 255, 255, 0.1) 20%, transparent 25%),
        linear-gradient(45deg, transparent 48%, rgba(255, 255, 255, 0.1) 50%, transparent 52%),
        linear-gradient(-45deg, transparent 48%, rgba(255, 255, 255, 0.1) 50%, transparent 52%);
      background-size: 100px 100px, 80px 80px, 60px 60px, 60px 60px;
      opacity: 0.3;
      animation: glassCrack 3s ease-in-out;
      pointer-events: none;
    }
    
    @keyframes glassCrack {
      0% {
        opacity: 0;
        transform: scale(1.5);
      }
      50% {
        opacity: 0.5;
      }
      100% {
        opacity: 0.3;
        transform: scale(1);
      }
    }
    
    /* Efek Petir */
    .lightning-effect {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.8), transparent);
      transform: skewX(-20deg);
      animation: lightning 0.5s ease-out;
      opacity: 0;
      pointer-events: none;
    }
    
    @keyframes lightning {
      0% {
        opacity: 0;
        transform: translateX(-100%) skewX(-20deg);
      }
      50% {
        opacity: 1;
      }
      100% {
        opacity: 0;
        transform: translateX(100%) skewX(-20deg);
      }
    }
    
    .popup-title {
      font-size: 2.5rem;
      font-weight: 700;
      background: linear-gradient(135deg, #ff00ff, #00ffff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 15px;
      text-shadow: 0 0 20px rgba(255, 0, 255, 0.5);
    }
    
    .popup-subtitle {
      font-size: 1.2rem;
      color: var(--gray-light);
      margin-bottom: 25px;
    }
    
    .popup-progress {
      width: 100%;
      height: 20px;
      background: var(--glass);
      border-radius: 10px;
      margin: 20px 0;
      overflow: hidden;
      border: 1px solid var(--glass-border);
    }
    
    .popup-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #ff00ff, #00ffff);
      border-radius: 10px;
      transition: width 0.3s ease;
      box-shadow: 0 0 10px rgba(255, 0, 255, 0.5);
    }
    
    .popup-controls {
      display: flex;
      justify-content: center;
      gap: 15px;
      margin-top: 25px;
    }
    
    .control-btn {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.3);
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.3s ease;
      font-size: 14px;
    }
    
    .control-btn:hover {
      background: rgba(255, 255, 255, 0.2);
      transform: translateY(-2px);
    }
    
    /* Notification Modern */
    .notification {
      position: fixed;
      top: 30px;
      right: 30px;
      padding: 16px 24px;
      background: linear-gradient(135deg, var(--accent) 0%, #34d399 100%);
      color: white;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
      z-index: 10000;
      transform: translateX(150%);
      transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .notification.show {
      transform: translateX(0);
    }
    
    .notification.error {
      background: linear-gradient(135deg, var(--danger) 0%, #f87171 100%);
    }
    
    .notification.warning {
      background: linear-gradient(135deg, var(--warning) 0%, #fbbf24 100%);
    }
    
    /* Responsive Design */
    @media (max-width: 768px) {
      .container {
        padding: 15px;
      }
      
      .header {
        padding: 30px 20px;
      }
      
      .header h1 {
        font-size: 2.2rem;
      }
      
      .dashboard {
        grid-template-columns: 1fr;
      }
      
      .input-group {
        flex-direction: column;
      }
      
      .actions {
        grid-template-columns: 1fr;
      }
      
      .clock-container {
        grid-template-columns: 1fr;
      }
      
      .popup-controls {
        flex-direction: column;
      }
    }
    
    /* Animation Utilities */
    .fade-in {
      animation: fadeIn 0.6s ease-out;
    }
    
    .slide-up {
      animation: slideUp 0.6s ease-out;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    
    @keyframes slideUp {
      from { 
        opacity: 0;
        transform: translateY(30px);
      }
      to { 
        opacity: 1;
        transform: translateY(0);
      }
    }
  </style>
</head>
<body>
  <!-- Background Animation -->
  <div class="bg-animation" id="bgAnimation"></div>

  <!-- Running Text -->
  <div class="running-text-container">
    <div class="running-text">
      SELAMAT DATANG WAHAI PEMUJA GRATISAN ð¤£ DAH PAKE AJA LAH GAES :v
    </div>
  </div>

  <!-- Popup Welcome -->
  <div class="popup-overlay" id="popupWelcome">
    <div class="popup-container">
      <div class="lightning-effect" id="lightningEffect"></div>
      <div class="popup-title">ANDRE CELL</div>
      <div class="popup-subtitle">PRESENTS</div>
      <div class="popup-content">
        <p>Welcome to ${decodedJudul} Worker - Premium Proxy Service</p>
        <p>Powered by advanced technology and secured connections</p>
        <div class="popup-progress">
          <div class="popup-progress-fill" id="popupProgress"></div>
        </div>
        <p id="loading-text">Loading system resources...</p>
      </div>
      <div class="popup-controls">
        <button class="control-btn" id="minimize-btn">
          <i class="fas fa-window-minimize"></i> Minimize
        </button>
        <button class="control-btn" id="maximize-btn">
          <i class="fas fa-window-maximize"></i> Maximize
        </button>
        <button class="control-btn" id="close-popup-btn">
          <i class="fas fa-times"></i> Close
        </button>
      </div>
    </div>
  </div>

  <div class="container">
    <!-- Header -->
    <header class="header fade-in">
      <div class="logo">
        <div class="logo-icon">
          <i class="fas fa-shield-alt"></i>
        </div>
      </div>
      <h1>${decodedJudul} WORKER</h1>
      <p>Modern Proxy Dashboard with Real-time Monitoring & Advanced Security</p>
      
      <div class="badge-container">
        <span class="badge"><i class="fas fa-bolt"></i> High Performance</span>
        <span class="badge"><i class="fas fa-shield"></i> Secure Connection</span>
        <span class="badge"><i class="fas fa-rocket"></i> Fast Setup</span>
        <span class="badge"><i class="fas fa-sync"></i> Auto Rotation</span>
      </div>
    </header>

    <!-- Digital Clock -->
    <div class="digital-clock slide-up">
      <div class="clock-container">
        <div class="time-zone">
          <div class="time-label">WIB (Jakarta)</div>
          <div class="time-value" id="wib-time">00:00:00</div>
        </div>
        <div class="time-zone">
          <div class="time-label">WITA (Makassar)</div>
          <div class="time-value" id="wita-time">00:00:00</div>
        </div>
        <div class="time-zone">
          <div class="time-label">WIT (Jayapura)</div>
          <div class="time-value" id="wit-time">00:00:00</div>
        </div>
      </div>
    </div>

    <!-- Dashboard -->
    <div class="dashboard">
      <!-- Connection Configuration -->
      <div class="card slide-up">
        <div class="card-header">
          <div class="card-icon">
            <i class="fas fa-sliders-h"></i>
          </div>
          <h3>Connection Setup</h3>
        </div>

        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">
              <i class="fas fa-fingerprint"></i>
              UUID
            </span>
            <span class="info-value" id="uuid-value">Generating...</span>
          </div>

          <div class="info-item">
            <span class="info-label">
              <i class="fas fa-server"></i>
              Server
            </span>
            <span class="info-value" id="proxy-value">Loading...</span>
          </div>

          <div class="info-item">
            <span class="info-label">
              <i class="fas fa-circle"></i>
              Status
            </span>
            <span class="info-value">
              <span style="color: var(--accent);">â</span>
              <span id="status-text">Active</span>
            </span>
          </div>
        </div>

        <!-- Wildcard Input -->
        <div class="input-group">
          <input type="text" class="modern-input" id="wildcard-input" 
                 placeholder="Enter domain (e.g., bug.com)" value="bug.com">
          <button class="btn btn-success" id="apply-wildcard-btn">
            <i class="fas fa-check"></i> Apply
          </button>
        </div>

        <!-- Custom Proxy -->
        <div class="input-group">
          <input type="text" class="modern-input" id="custom-ip" 
                 placeholder="Proxy IP (e.g., 1.2.3.4)">
          <input type="text" class="modern-input" id="custom-port" 
                 placeholder="Port (e.g., 443)">
          <button class="btn btn-outline" id="apply-custom-proxy-btn">
            <i class="fas fa-server"></i> Custom
          </button>
        </div>

        <div class="config-box" id="config-box">
          // Configuration will be generated here...
        </div>

        <div class="progress-bar">
          <div class="progress-fill" id="config-progress" style="width: 0%"></div>
        </div>

        <div class="actions">
          <button class="btn" id="refresh-btn">
            <i class="fas fa-sync-alt"></i> Refresh
          </button>
          <button class="btn btn-success" id="copy-btn">
            <i class="fas fa-copy"></i> Copy
          </button>
          <button class="btn btn-secondary" id="generate-vless-btn">
            <i class="fas fa-bolt"></i> ${decodedFlash}
          </button>
        </div>
      </div>

      <!-- Connection Status -->
      <div class="card slide-up">
        <div class="card-header">
          <div class="card-icon">
            <i class="fas fa-chart-line"></i>
          </div>
          <h3>Connection Status</h3>
        </div>

        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">
              <i class="fas fa-signal"></i>
              Current Ping
            </span>
            <span class="info-value">
              <span id="ping-value" style="color: var(--accent);">--</span>
              <span id="ping-status">ms</span>
            </span>
          </div>

          <div class="info-item">
            <span class="info-label">
              <i class="fas fa-clock"></i>
              Last Check
            </span>
            <span class="info-value" id="last-check">Never</span>
          </div>

          <div class="info-item">
            <span class="info-label">
              <i class="fas fa-stopwatch"></i>
              Server Uptime
            </span>
            <span class="info-value" id="uptime-value">Calculating...</span>
          </div>
        </div>

        <div class="actions">
          <button class="btn" id="ping-btn">
            <i class="fas fa-satellite-dish"></i> Test Ping
          </button>
          <button class="btn btn-outline" id="auto-ping-btn">
            <i class="fas fa-sync"></i> Auto Ping
          </button>
        </div>
      </div>

      <!-- Proxy Management -->
      <div class="card slide-up">
        <div class="card-header">
          <div class="card-icon">
            <i class="fas fa-network-wired"></i>
          </div>
          <h3>Proxy Management</h3>
        </div>

        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">
              <i class="fas fa-shield-alt"></i>
              Active Proxy
            </span>
            <span class="info-value" id="active-proxy">Loading...</span>
          </div>

          <div class="info-item">
            <span class="info-label">
              <i class="fas fa-database"></i>
              Proxy Pool
            </span>
            <span class="info-value" id="proxy-count">Loading...</span>
          </div>

          <div class="info-item">
            <span class="info-label">
              <i class="fas fa-sync"></i>
              Auto Rotation
            </span>
            <span class="info-value">
              <span style="color: var(--accent);">â</span>
              <span id="auto-rotate-status">Active (60s)</span>
            </span>
          </div>
        </div>

        <div class="config-box" id="proxy-list">
          Loading proxy list...
        </div>

        <div class="actions">
          <button class="btn" id="rotate-proxy-btn">
            <i class="fas fa-random"></i> Rotate
          </button>
          <button class="btn btn-outline" id="refresh-proxies-btn">
            <i class="fas fa-redo"></i> Refresh
          </button>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <footer class="footer fade-in">
      <p>${decodedJudul} Worker â¢ Modern Proxy Dashboard â¢ Advanced Security System</p>
      
      <div class="credit">
        <p>Powered by <strong>ANDRE CELL</strong> | 
          <a href="https://github.com/megawanted" target="_blank">@megawanted</a> â¢ 
          <a href="#" target="_blank">@bangjeelss</a> â¢ 
          <a href="#" target="_blank">@Vpnjatim</a> â¢ 
          <a href="#" target="_blank">@Zero</a>
        </p>
      </div>
      
      <p style="margin-top:15px; font-size:0.8rem; color: var(--gray);">
        Secure proxy system with automatic UUID generation and real-time monitoring
      </p>
    </footer>
  </div>

  <!-- Notification -->
  <div class="notification" id="notification">
    <span id="notification-text">Operation completed successfully!</span>
  </div>

<script>
  // Background Animation
  function createParticles() {
    const container = document.getElementById('bgAnimation');
    const particles = 15;
    
    for (let i = 0; i < particles; i++) {
      const particle = document.createElement('div');
      particle.className = 'bg-particle';
      
      const size = Math.random() * 200 + 50;
      const posX = Math.random() * 100;
      const posY = Math.random() * 100;
      const delay = Math.random() * 20;
      
      particle.style.width = size + 'px';
      particle.style.height = size + 'px';
      particle.style.left = posX + '%';
      particle.style.top = posY + '%';
      particle.style.animationDelay = delay + 's';
      particle.style.opacity = Math.random() * 0.1 + 0.05;
      
      container.appendChild(particle);
    }
  }

  // Digital Clock
 
  function updateDigitalClock() {
    const now = new Date();
    
    // WIB (Jakarta) UTC+7
    const wibTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    document.getElementById('wib-time').textContent = wibTime.toUTCString().split(' ')[4];
    
    // WITA (Makassar) UTC+8
    const witaTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    document.getElementById('wita-time').textContent = witaTime.toUTCString().split(' ')[4];
    
    // WIT (Jayapura) UTC+9
    const witTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    document.getElementById('wit-time').textContent = witTime.toUTCString().split(' ')[4];
  }

  // Popup Welcome dengan Efek Kaca Retak dan Petir
  function initPopup() {
    const popup = document.getElementById('popupWelcome');
    const popupProgress = document.getElementById('popupProgress');
    const loadingText = document.getElementById('loading-text');
    const lightningEffect = document.getElementById('lightningEffect');
    const minimizeBtn = document.getElementById('minimize-btn');
    const maximizeBtn = document.getElementById('maximize-btn');
    const closeBtn = document.getElementById('close-popup-btn');
    
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += 1;
      popupProgress.style.width = progress + '%';
      
      if (progress === 50) {
        loadingText.textContent = 'Almost there...';
        // Trigger efek petir pertama
        lightningEffect.style.animation = 'lightning 0.5s ease-out';
        setTimeout(() => {
          lightningEffect.style.animation = '';
        }, 500);
      }
      
      if (progress === 80) {
        loadingText.textContent = 'Finalizing...';
        // Trigger efek petir kedua
        setTimeout(() => {
          lightningEffect.style.animation = 'lightning 0.5s ease-out';
          setTimeout(() => {
            lightningEffect.style.animation = '';
          }, 500);
        }, 300);
      }
      
      if (progress >= 100) {
        clearInterval(progressInterval);
        loadingText.textContent = 'Complete! Ready to launch...';
        
        // Trigger efek petir terakhir sebelum menutup
        setTimeout(() => {
          lightningEffect.style.animation = 'lightning 0.5s ease-out';
          setTimeout(() => {
            // Animasi mengerucut saat menghilang
            popup.style.opacity = '0';
            popup.style.transform = 'scale(0.1) rotate(180deg)';
            setTimeout(() => {
              popup.style.display = 'none';
            }, 500);
          }, 500);
        }, 1000);
      }
    }, 30);
    
    // Tombol kontrol popup
    minimizeBtn.addEventListener('click', function() {
      popup.style.transform = 'scale(0.8)';
      popup.style.opacity = '0.7';
    });
    
    maximizeBtn.addEventListener('click', function() {
      popup.style.transform = 'scale(1)';
      popup.style.opacity = '1';
    });
    
    closeBtn.addEventListener('click', function() {
      popup.style.opacity = '0';
      popup.style.transform = 'scale(0.1) rotate(180deg)';
      setTimeout(() => {
        popup.style.display = 'none';
      }, 500);
    });
  }

  // Initialize
  document.addEventListener('DOMContentLoaded', function() {
    createParticles();
    setInterval(updateDigitalClock, 1000);
    updateDigitalClock();
    initPopup();
    
    // Add interactive effects to cards
    document.querySelectorAll('.card').forEach(card => {
      card.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-8px) scale(1.02)';
      });
      
      card.addEventListener('mouseleave', function() {
        this.style.transform = 'translateY(0) scale(1)';
      });
    });
  });

  // Elements
  const uuidValue = document.getElementById('uuid-value');
  const proxyValue = document.getElementById('proxy-value');
  const configBox = document.getElementById('config-box');
  const configProgress = document.getElementById('config-progress');
  const pingValue = document.getElementById('ping-value');
  const pingStatus = document.getElementById('ping-status');
  const lastCheck = document.getElementById('last-check');
  const uptimeValue = document.getElementById('uptime-value');
  const statusText = document.getElementById('status-text');
  const activeProxy = document.getElementById('active-proxy');
  const proxyCount = document.getElementById('proxy-count');
  const proxyList = document.getElementById('proxy-list');
  const notification = document.getElementById('notification');
  const notificationText = document.getElementById('notification-text');
  const wildcardInput = document.getElementById('wildcard-input');
  const applyWildcardBtn = document.getElementById('apply-wildcard-btn');
  const customIP = document.getElementById('custom-ip');
  const customPort = document.getElementById('custom-port');
  const applyCustomProxyBtn = document.getElementById('apply-custom-proxy-btn');

  const refreshBtn = document.getElementById('refresh-btn');
  const copyBtn = document.getElementById('copy-btn');
  const generateVlessBtn = document.getElementById('generate-vless-btn');
  const pingBtn = document.getElementById('ping-btn');
  const autoPingBtn = document.getElementById('auto-ping-btn');
  const rotateProxyBtn = document.getElementById('rotate-proxy-btn');
  const refreshProxiesBtn = document.getElementById('refresh-proxies-btn');

  let autoPingInterval = null;
  let autoRotateInterval = null;
  let currentConfig = null;
  let currentDomain = 'bug.com';
  let currentIP = null;
  let currentPort = null;


  function showNotification(message, type) {
    if (!type) type = 'success';
    notificationText.textContent = message;
    notification.className = 'notification show';
    if (type === 'error') {
      notification.classList.add('error');
    } else if (type === 'warning') {
      notification.classList.add('warning');
    } else {
      notification.classList.remove('error', 'warning');
    }
    
    setTimeout(function() { 
      notification.classList.remove('show'); 
    }, 3000);
  }

  async function loadConfig(domain, ip, port) {
    if (!domain) domain = currentDomain;
    try {
      configProgress.style.width = '30%';
      
      let url = '/sub?domain=' + domain;
      if (ip && port) {
        url += '&ip=' + ip + '&port=' + port;
      }
      
      const res = await fetch(url);
      const text = await res.text();
      configProgress.style.width = '70%';

      let data;
      try { data = JSON.parse(text); } catch(e) { data = { error: text }; }
      configProgress.style.width = '90%';

      if (data && !data.error) {
        uuidValue.textContent = data.uuid || 'n/a';
        proxyValue.textContent = data.ip + ':' + data.port + ' (' + (data.org || data.country || 'Unknown') + ')';

        activeProxy.textContent = proxyValue.textContent;

        if (data.config_vls && typeof data.config_vls === "object") {
          const firstKey = Object.keys(data.config_vls)[0];
          configBox.textContent = data.config_vls[firstKey];
          currentConfig = data.config_vls[firstKey];
        } else {
          configBox.textContent = data.config_vls || JSON.stringify(data, null, 2);
          currentConfig = configBox.textContent;
        }

        /* Load Proxy List Dari Negara */

      
       const allRes = await fetch('/ALL.txt');
       const proxies = await allRes.json(); // karena sudah JSON array valid
       proxyCount.textContent = proxies.length + ' proxies available';
       proxyList.innerHTML = '';
       
         
        proxies.forEach(function(p) {
          const div = document.createElement('div');
          div.style.padding = '8px';
          div.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
          div.style.fontSize = '11px';
          div.innerHTML = p.prxIP + ':' + p.prxPort + ' - ' + (p.org || p.country || '');
          proxyList.appendChild(div);
        });

        await testPing({ ip: data.ip, port: data.port });
      } else {
        configBox.textContent = 'No config (error)';
        showNotification('No config returned', 'error');
      }

      setTimeout(function() { configProgress.style.width = '0%'; }, 1000);
    } catch (err) {
      console.error(err);
      configBox.textContent = 'Error loading configuration';
      showNotification('Error loading configuration', 'error');
    }
  }

  function applyWildcard() {
    const domain = wildcardInput.value.trim();
    if (!domain) {
      showNotification('Please enter a domain!', 'error');
      return;
    }

    if (!domain.includes('.') || domain.length < 3) {
      showNotification('Invalid domain format!', 'error');
      return;
    }

    currentDomain = domain;
    currentIP = null;
    currentPort = null;
    showNotification('Domain applied: ' + domain, 'success');
    loadConfig(domain);
  }

  function applyCustomProxy() {
    const ip = customIP.value.trim();
    const port = customPort.value.trim();
    
    if (!ip || !port) {
      showNotification('Please enter IP and Port!', 'error');
      return;
    }

    // FIXED: Remove double backslash in regex patterns
    const ipRegex = /^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$/;
    if (!ipRegex.test(ip)) {
      showNotification('Invalid IP format!', 'error');
      return;
    }

    const portRegex = /^\\d+$/;
    if (!portRegex.test(port) || port < 1 || port > 65535) {
      showNotification('Invalid Port format!', 'error');
      return;
    }

    currentIP = ip;
    currentPort = port;
    showNotification('Custom proxy applied: ' + ip + ':' + port, 'success');
    loadConfig(currentDomain, ip, port);
  }

  async function testPing(proxy) {
    try {
      pingValue.textContent = '...';
      pingValue.style.color = 'var(--warning)';
      pingStatus.textContent = 'Testing...';

      const ipPort = proxy.ip + ':' + (proxy.port || '443');
      const res = await fetch('/health?ip=' + encodeURIComponent(ipPort));

      const data = await res.json();

      let latency = (data && typeof data.delay !== 'undefined') ? Number(data.delay) : null;
      if (latency !== null && !isNaN(latency)) {
        pingValue.textContent = latency;
        if (latency < 100) { 
          pingValue.style.color = 'var(--accent)'; 
          pingStatus.textContent = 'ms (Excellent)'; 
        } else if (latency < 300) { 
          pingValue.style.color = 'var(--warning)'; 
          pingStatus.textContent = 'ms (Good)'; 
        } else { 
          pingValue.style.color = 'var(--danger)'; 
          pingStatus.textContent = 'ms (Slow)'; 
        }
      } else {
        pingValue.textContent = 'N/A';
        pingValue.style.color = 'var(--danger)';
        pingStatus.textContent = 'No delay';
      }

      lastCheck.textContent = new Date().toLocaleTimeString();
      statusText.textContent = 'Active';
      return latency;
    } catch (err) {
      console.error('Error testing ping:', err);
      pingValue.textContent = 'Error';
      pingValue.style.color = 'var(--danger)';
      pingStatus.textContent = 'Connection failed';
      statusText.textContent = 'Error';
      return null;
    }
  }

  function toggleAutoPing() {
    if (autoPingInterval) {
      clearInterval(autoPingInterval);
      autoPingInterval = null;
      autoPingBtn.innerHTML = '<i class="fas fa-sync"></i> Auto Ping';
      autoPingBtn.classList.remove('btn-danger');
      showNotification('Auto ping stopped');
    } else {
      const parts = (activeProxy.textContent || '').split(':');
      const ip = parts[0];
      const port = parts[1] ? parts[1].split(' ')[0] : '443';
      testPing({ ip: ip, port: port });
      autoPingInterval = setInterval(function() { testPing({ ip: ip, port: port }); }, 5000);
      autoPingBtn.innerHTML = '<i class="fas fa-stop"></i> Stop Auto Ping';
      autoPingBtn.classList.add('btn-danger');
      showNotification('Auto ping started');
    }
  }

  function startAutoRotate() {
    if (autoRotateInterval) {
      clearInterval(autoRotateInterval);
    }
    autoRotateInterval = setInterval(function() {
      loadConfig(currentDomain, currentIP, currentPort);
      showNotification('Auto rotate: Proxy updated', 'success');
    }, 60000);
  }

  async function copyConfig() {
    if (!currentConfig) return showNotification('No configuration to copy', 'error');
    try {
      await navigator.clipboard.writeText(currentConfig);
      showNotification('Configuration copied to clipboard!');
    } catch (err) {
      showNotification('Error copying configuration', 'error');
    }
  }

  async function updateUptime() {
    const res = await fetch("/uptime");
    const data = await res.json();
    uptimeValue.textContent = data.uptime;
  }

  async function rotateProxy() {
    rotateProxyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rotating...';
    await loadConfig(currentDomain);
    showNotification('Proxy rotated successfully!');
    rotateProxyBtn.innerHTML = '<i class="fas fa-random"></i> Rotate';
  }

  async function refreshProxies() {
    refreshProxiesBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
    await loadConfig(currentDomain);
    showNotification('Proxy list refreshed!');
    refreshProxiesBtn.innerHTML = '<i class="fas fa-redo"></i> Refresh';
  }

  // Event listeners
  refreshBtn.addEventListener('click', function() { loadConfig(currentDomain, currentIP, currentPort); });
  copyBtn.addEventListener('click', copyConfig);
  generateVlessBtn.addEventListener('click', function() { loadConfig(currentDomain, currentIP, currentPort); });
  pingBtn.addEventListener('click', function() {
    const parts = (activeProxy.textContent || '').split(':');
    const ip = parts[0];
    const port = parts[1] ? parts[1].split(' ')[0] : '443';
    testPing({ ip: ip, port: port });
  });
  autoPingBtn.addEventListener('click', toggleAutoPing);
  rotateProxyBtn.addEventListener('click', rotateProxy);
  refreshProxiesBtn.addEventListener('click', refreshProxies);
  applyWildcardBtn.addEventListener('click', applyWildcard);
  applyCustomProxyBtn.addEventListener('click', applyCustomProxy);
  
  wildcardInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      applyWildcard();
    }
  });

  // Initial load
  loadConfig(currentDomain);
  startAutoRotate();
  
  setTimeout(function() {
    const parts = (activeProxy.textContent || '').split(':');
    const ip = parts[0];
    const port = parts[1] ? parts[1].split(' ')[0] : '443';
    testPing({ ip: ip, port: port });
  }, 1000);

  setInterval(updateUptime, 1000);
</script>

</body>
</html>
`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate"
    }
  });
}

/* =======================
   TRAFFIC STATS ENDPOINT
   ======================= */
async function serveTrafficStats(request, env) {
  await loadTrafficStats(env);
  const url = new URL(request.url);
  
  if (url.searchParams.get('reset') === 'true' && request.method === 'POST') {
    trafficStats = {
      totalVisitors: 0,
      uniqueVisitors: new Set(),
      bandwidthUsed: 0,
      todayVisitors: 0,
      todayBandwidth: 0,
      lastReset: new Date().toISOString().split('T')[0]
    };
    await saveTrafficStats(env);
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Traffic data reset successfully' 
    }), {
      headers: { 
        "Content-Type": "application/json",
        ...CORS_HEADER_OPTIONS
      }
    });
  }
  
  const stats = {
    totalVisitors: trafficStats.totalVisitors,
    todayVisitors: trafficStats.todayVisitors,
    totalBandwidth: formatBytes(trafficStats.bandwidthUsed),
    todayBandwidth: formatBytes(trafficStats.todayBandwidth),
    totalBandwidthValue: trafficStats.bandwidthUsed,
    todayBandwidthValue: trafficStats.todayBandwidth,
    lastReset: trafficStats.lastReset
  };
  
  return new Response(JSON.stringify(stats), {
    headers: { 
      "Content-Type": "application/json",
      ...CORS_HEADER_OPTIONS
    }
  });
}

/* =======================
   Simple /ping
   ======================= */
async function servePing() {
  return new Response(JSON.stringify({
    status: "ok",
    timestamp: Date.now(),
    message: "Ping test successful"
  }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

/* =======================
   Expose SG and ID raw lists
   ======================= */
async function servePrxList(country) {
  const list = await getPrx(country);
  return new Response(JSON.stringify(list, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

async function checkPrxHealth(proxyIP, proxyPort) {
  const req = await fetch(`${PRX_HEALTH_CHECK_API}?ip=${proxyIP}:${proxyPort}`);
  return await req.json();
}

const GLOBAL_TIME_API = "https://worldtimeapi.org/api/timezone/Asia/Jakarta";

async function getRealNow() {
  try {
    const res = await fetch(GLOBAL_TIME_API);
    const data = await res.json();
    return new Date(data.datetime).getTime(); // WIB time
  } catch {
    return Date.now();
  }
}

// ========== CLOUDLARE WORKER WIB UPTIME FIXED ==========
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}


async function getServerStartTime(env) {

  if (!globalThis._serverStartTime) {
   
    const now = Date.now() + 7 * 60 * 60 * 1000;
    globalThis._serverStartTime = now;
    globalThis._serverStartDate = new Date(now);
  }
  return {
    time: globalThis._serverStartTime,
    date: globalThis._serverStartDate
  };
}

async function getUptimeResponse(env) {
  const start = await getServerStartTime(env);
  const diff = Date.now() + 7 * 60 * 60 * 1000 - start.time;
  return {
    status: "ok",
    timezone: "Asia/Jakarta",
    uptime: formatDuration(diff),
    startedAt: start.date.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
  };
}



/* =======================
   MAIN WORKER HANDLER
   ======================= */
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const upgradeHeader = request.headers.get("Upgrade");

      if (upgradeHeader !== "websocket") {
        const originalResponse = await this.handleRequest(request, env, ctx);
        
        const contentLength = originalResponse.headers.get("content-length");
        let responseSize = contentLength ? parseInt(contentLength) : 0;

        if (!responseSize) {
          try {
            const clone = originalResponse.clone();
            const body = await clone.text();
            responseSize = new TextEncoder().encode(body).length;
          } catch (_) {
            responseSize = 0;
          }
        }

        if (env && ctx) {
          ctx.waitUntil(updateTrafficStats(request, responseSize, env));
        }

        return originalResponse;
      }

      return await this.handleRequest(request, env, ctx);
    } catch (err) {
      return new Response(`An error occurred: ${err.toString()}`, {
        status: 500,
        headers: { ...CORS_HEADER_OPTIONS },
      });
    }
  },

  async handleRequest(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const upgradeHeader = request.headers.get("Upgrade");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADER_OPTIONS });
    }

    if (pathname === "/") {
      return serveUI();
    }

    if (pathname === "/traffic") {
      return await serveTrafficStats(request, env);
    }

    if (pathname === "/health") {
      const ipPort = url.searchParams.get("ip");
      if (!ipPort) {
        return new Response(JSON.stringify({ error: "missing_ip" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const [ip, port] = ipPort.split(":");
      const result = await checkPrxHealth(ip, port || "443");
      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (pathname === "/SG.txt") {
      return await servePrxList("SG");
    }
    if (pathname === "/ID.txt") {
      return await servePrxList("ID");
    }
    if (pathname === "/IN.txt") {
      return await servePrxList("IN");
    }
    if (pathname === "/ALL.txt") {
      return await servePrxList();
    }

    if (pathname.startsWith("/sub")) {
      const params = Object.fromEntries(url.searchParams.entries());
      const out = await generateSubscription(params, request);
      return new Response(out, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...CORS_HEADER_OPTIONS,
        },
      });
    }

    if (pathname === "/ping") {
      return servePing();
    }
if (pathname === "/uptime") {
  const info = await getUptimeResponse(env);
  return new Response(JSON.stringify(info), {
    headers: { "Content-Type": "application/json" }
  });
}



    if (upgradeHeader === "websocket") {
      const prxMatch = url.pathname.match(/^\/(.+[:=-]\d+)$/);
      if (prxMatch) {
        prxIP = prxMatch[1];
        return await websocketHandler(request);
      }
    }

    const targetReversePrx = (env && env.REVERSE_PRX_TARGET) || "example.com";
    return await reverseWeb(request, targetReversePrx, null, env, ctx);
  },
};
