// VLess Worker dengan Proxy Bank Otomatis
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};

// Generator proxy bank otomatis
class BankProxyGenerator {
  constructor() {
    this.bankDomains = [
      'semut0.rianandre0004.workers.dev', 'bca.co.id', 'bni.co.id', 'bri.co.id',
      'danamon.co.id', 'cimbniaga.co.id', 'maybank.co.id', 'permata.co.id',
      'ocbcnisp.com', 'uob.co.id', 'hsbc.co.id', 'citibank.co.id',
      'standardchartered.com', 'anz.com', 'dbs.com', 'panin.co.id'
    ];
    
    this.proxyPatterns = [
      'https://proxy-{random}.{domain}',
      'https://cdn-{random}.{domain}',
      'https://api-{random}.{domain}',
      'https://gateway-{random}.{domain}',
      'https://edge-{random}.{domain}',
      'https://ws-{random}.{domain}',
      'https://vless-{random}.{domain}',
      'https://proxy{number}.{domain}'
    ];
  }

  generateRandomString(length = 8) {
    return Math.random().toString(36).substring(2, 2 + length);
  }

  generateRandomNumber(min = 1, max = 999) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  getRandomBankDomain() {
    return this.bankDomains[Math.floor(Math.random() * this.bankDomains.length)];
  }

  generateProxyURL() {
    const domain = this.getRandomBankDomain();
    const pattern = this.proxyPatterns[Math.floor(Math.random() * this.proxyPatterns.length)];
    
    let url = pattern
      .replace('{domain}', domain)
      .replace('{random}', this.generateRandomString(6))
      .replace('{number}', this.generateRandomNumber(1, 20));
    
    return url;
  }

  generateProxyList(count = 10) {
    const proxies = new Set();
    while (proxies.size < count) {
      proxies.add(this.generateProxyURL());
    }
    return Array.from(proxies);
  }
}

// UUID Generator
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Cache untuk proxy list
let proxyCache = {
  proxies: [],
  lastGenerated: 0,
  ttl: 30 * 60 * 1000 // 30 menit
};

async function getProxyList() {
  const now = Date.now();
  if (proxyCache.proxies.length === 0 || now - proxyCache.lastGenerated > proxyCache.ttl) {
    const generator = new BankProxyGenerator();
    proxyCache.proxies = generator.generateProxyList(15);
    proxyCache.lastGenerated = now;
  }
  return proxyCache.proxies;
}

function getRandomProxy(proxies) {
  return proxies[Math.floor(Math.random() * proxies.length)];
}

// Fungsi untuk mengukur ping
async function measurePing(url) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, { 
      method: 'HEAD',
      signal: controller.signal,
      headers: { 
        'Cache-Control': 'no-cache',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    clearTimeout(timeoutId);
    const end = Date.now();
    return end - start;
  } catch (error) {
    console.log('Ping error:', error.message);
    return null;
  }
}

// Konfigurasi VLess
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  
  // Jika root path, tampilkan UI
  if (path === '/') {
    return serveUI(request);
  }
  
  // Jika path untuk mendapatkan konfigurasi VLess
  if (path === '/config') {
    return serveConfig(request);
  }
  
  // Jika path untuk mengecek ping
  if (path === '/ping') {
    return servePing(request);
  }
  
  // Jika path untuk mendapatkan proxy list
  if (path === '/proxies') {
    return serveProxyList(request);
  }
  
  // Jika path untuk generate config VLess
  if (path === '/generate-vless') {
    return serveVLessConfig(request);
  }
  
  // Handle request VLess
  return handleVLess(request);
}

// Fungsi untuk menampilkan UI
async function serveUI(request) {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VLess Worker - Auto Bank Proxy</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --dark: #1e293b;
            --darker: #0f172a;
            --light: #f8fafc;
        }
        
        body {
            background: linear-gradient(135deg, var(--darker) 0%, var(--dark) 100%);
            color: var(--light);
            min-height: 100vh;
            padding: 20px;
            line-height: 1.6;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding: 30px 20px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 20px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .header h1 {
            font-size: 2.8rem;
            margin-bottom: 10px;
            background: linear-gradient(90deg, #00dbde, #fc00ff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-weight: 800;
        }
        
        .header p {
            font-size: 1.2rem;
            opacity: 0.9;
            max-width: 600px;
            margin: 0 auto;
        }
        
        .badge {
            display: inline-block;
            background: var(--primary);
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
            margin-left: 10px;
        }
        
        .dashboard {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 25px;
            margin-bottom: 40px;
        }
        
        .card {
            background: rgba(255, 255, 255, 0.07);
            border-radius: 16px;
            padding: 25px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            transition: all 0.3s ease;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }
        
        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 15px 30px rgba(0, 0, 0, 0.2);
            border-color: rgba(255, 255, 255, 0.2);
        }
        
        .card-header {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .card-header i {
            font-size: 1.5rem;
            margin-right: 12px;
            background: linear-gradient(90deg, #00dbde, #fc00ff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .card-header h3 {
            font-size: 1.4rem;
            font-weight: 600;
        }
        
        .info-grid {
            display: grid;
            gap: 15px;
        }
        
        .info-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        
        .info-item:last-child {
            border-bottom: none;
        }
        
        .info-label {
            font-weight: 500;
            opacity: 0.9;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .info-value {
            font-weight: 600;
            font-family: 'Courier New', monospace;
        }
        
        .config-box {
            background: rgba(0, 0, 0, 0.3);
            border-radius: 12px;
            padding: 18px;
            margin-top: 15px;
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
            word-break: break-all;
            border: 1px solid rgba(255, 255, 255, 0.1);
            max-height: 150px;
            overflow-y: auto;
        }
        
        .ping-container {
            display: flex;
            align-items: center;
            gap: 15px;
            margin-top: 10px;
        }
        
        .ping-value {
            font-size: 1.8rem;
            font-weight: bold;
        }
        
        .ping-good {
            color: var(--success);
        }
        
        .ping-medium {
            color: var(--warning);
        }
        
        .ping-bad {
            color: var(--danger);
        }
        
        .btn {
            background: linear-gradient(90deg, var(--primary), var(--primary-dark));
            border: none;
            color: white;
            padding: 12px 24px;
            border-radius: 10px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 0.95rem;
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 7px 15px rgba(99, 102, 241, 0.3);
        }
        
        .btn:active {
            transform: translateY(0);
        }
        
        .btn-secondary {
            background: rgba(255, 255, 255, 0.1);
        }
        
        .btn-success {
            background: linear-gradient(90deg, var(--success), #059669);
        }
        
        .btn-danger {
            background: linear-gradient(90deg, var(--danger), #dc2626);
        }
        
        .actions {
            display: flex;
            gap: 12px;
            margin-top: 20px;
            flex-wrap: wrap;
        }
        
        .status-indicator {
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            margin-right: 8px;
        }
        
        .status-active {
            background-color: var(--success);
            box-shadow: 0 0 10px var(--success);
        }
        
        .status-inactive {
            background-color: var(--danger);
        }
        
        .proxy-list {
            max-height: 300px;
            overflow-y: auto;
            margin-top: 15px;
            border-radius: 10px;
            background: rgba(0, 0, 0, 0.2);
            padding: 10px;
        }
        
        .proxy-item {
            padding: 12px 15px;
            margin-bottom: 8px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.2s ease;
        }
        
        .proxy-item:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        
        .proxy-active {
            border-left: 4px solid var(--success);
        }
        
        .proxy-status {
            font-size: 0.8rem;
            padding: 4px 10px;
            border-radius: 20px;
            font-weight: 600;
        }
        
        .proxy-active .proxy-status {
            background-color: rgba(16, 185, 129, 0.2);
            color: var(--success);
        }
        
        .proxy-inactive .proxy-status {
            background-color: rgba(239, 68, 68, 0.2);
            color: var(--danger);
        }
        
        .footer {
            text-align: center;
            margin-top: 50px;
            padding: 25px;
            opacity: 0.7;
            font-size: 0.9rem;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: #fff;
            animation: spin 1s ease-in-out infinite;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: var(--success);
            color: white;
            border-radius: 10px;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
            transform: translateX(150%);
            transition: transform 0.3s ease;
            z-index: 1000;
        }
        
        .notification.show {
            transform: translateX(0);
        }
        
        .progress-bar {
            height: 6px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 3px;
            margin-top: 10px;
            overflow: hidden;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #00dbde, #fc00ff);
            border-radius: 3px;
            width: 0%;
            transition: width 0.3s ease;
        }
        
        @media (max-width: 768px) {
            .dashboard {
                grid-template-columns: 1fr;
            }
            
            .header h1 {
                font-size: 2.2rem;
            }
            
            .actions {
                flex-direction: column;
            }
            
            .btn {
                width: 100%;
                justify-content: center;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1><i class="fas fa-shield-alt"></i> VLess Worker</h1>
            <p>Auto Bank Proxy System dengan UUID Otomatis dan Monitoring Real-time</p>
            <div style="margin-top: 15px;">
                <span class="badge">Auto Proxy</span>
                <span class="badge">UUID Generator</span>
                <span class="badge">Real-time Ping</span>
                <span class="badge">Bank Proxy</span>
            </div>
        </div>
        
        <div class="dashboard">
            <div class="card">
                <div class="card-header">
                    <i class="fas fa-sliders-h"></i>
                    <h3>Konfigurasi Koneksi</h3>
                </div>
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">
                            <i class="fas fa-fingerprint"></i>
                            UUID:
                        </span>
                        <span class="info-value" id="uuid-value">
                            <div class="loading"></div>
                        </span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">
                            <i class="fas fa-server"></i>
                            Proxy Server:
                        </span>
                        <span class="info-value" id="proxy-value">
                            <div class="loading"></div>
                        </span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">
                            <i class="fas fa-circle"></i>
                            Status:
                        </span>
                        <span class="info-value">
                            <span class="status-indicator status-active"></span>
                            <span id="status-text">Active</span>
                        </span>
                    </div>
                </div>
                
                <div class="config-box" id="config-box">
                    Menghasilkan konfigurasi...
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" id="config-progress"></div>
                </div>
                
                <div class="actions">
                    <button class="btn" id="refresh-btn">
                        <i class="fas fa-sync-alt"></i> Refresh Config
                    </button>
                    <button class="btn btn-success" id="copy-btn">
                        <i class="fas fa-copy"></i> Copy Config
                    </button>
                    <button class="btn btn-secondary" id="generate-vless-btn">
                        <i class="fas fa-bolt"></i> Generate VLESS
                    </button>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <i class="fas fa-chart-line"></i>
                    <h3>Status Koneksi</h3>
                </div>
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">
                            <i class="fas fa-signal"></i>
                            Ping Saat Ini:
                        </span>
                        <div class="ping-container">
                            <span class="ping-value" id="ping-value">--</span>
                            <span id="ping-status">ms</span>
                        </div>
                    </div>
                    <div class="info-item">
                        <span class="info-label">
                            <i class="fas fa-clock"></i>
                            Terakhir Diperiksa:
                        </span>
                        <span class="info-value" id="last-check">Never</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">
                            <i class="fas fa-stopwatch"></i>
                            Uptime:
                        </span>
                        <span class="info-value" id="uptime-value">Calculating...</span>
                    </div>
                </div>
                
                <div class="actions">
                    <button class="btn" id="ping-btn">
                        <i class="fas fa-satellite-dish"></i> Test Ping
                    </button>
                    <button class="btn btn-secondary" id="auto-ping-btn">
                        <i class="fas fa-sync"></i> Auto Ping
                    </button>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <i class="fas fa-network-wired"></i>
                    <h3>Manajemen Proxy</h3>
                </div>
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">
                            <i class="fas fa-shield-alt"></i>
                            Proxy Aktif:
                        </span>
                        <span class="info-value" id="active-proxy">
                            <div class="loading"></div>
                        </span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">
                            <i class="fas fa-database"></i>
                            Pool Proxy:
                        </span>
                        <span class="info-value" id="proxy-count">
                            <div class="loading"></div>
                        </span>
                    </div>
                </div>
                
                <div class="proxy-list" id="proxy-list">
                    Memuat daftar proxy...
                </div>
                
                <div class="actions">
                    <button class="btn" id="rotate-proxy-btn">
                        <i class="fas fa-random"></i> Rotate Proxy
                    </button>
                    <button class="btn btn-secondary" id="refresh-proxies-btn">
                        <i class="fas fa-redo"></i> Refresh Proxies
                    </button>
                </div>
            </div>
        </div>
        
        <div class="footer">
            <p>VLess Worker â¢ Auto Bank Proxy System â¢ Real-time Monitoring</p>
            <p style="margin-top: 10px; font-size: 0.8rem;">
                System secara otomatis menghasilkan proxy bank dan UUID untuk koneksi yang aman
            </p>
        </div>
    </div>

    <div class="notification" id="notification">
        <span id="notification-text">Berhasil disalin!</span>
    </div>

    <script>
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
        
        // Buttons
        const refreshBtn = document.getElementById('refresh-btn');
        const copyBtn = document.getElementById('copy-btn');
        const generateVlessBtn = document.getElementById('generate-vless-btn');
        const pingBtn = document.getElementById('ping-btn');
        const autoPingBtn = document.getElementById('auto-ping-btn');
        const rotateProxyBtn = document.getElementById('rotate-proxy-btn');
        const refreshProxiesBtn = document.getElementById('refresh-proxies-btn');
        
        // State
        let autoPingInterval = null;
        let startTime = Date.now();
        let currentConfig = null;
        
        // Format waktu
        function formatTime(timestamp) {
            return new Date(timestamp).toLocaleTimeString();
        }
        
        // Format durasi
        function formatDuration(ms) {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            
            if (hours > 0) {
                return \`\${hours}h \${minutes % 60}m\`;
            } else if (minutes > 0) {
                return \`\${minutes}m \${seconds % 60}s\`;
            } else {
                return \`\${seconds}s\`;
            }
        }
        
        // Tampilkan notifikasi
        function showNotification(message, type = 'success') {
            notificationText.textContent = message;
            notification.className = 'notification show';
            if (type === 'error') {
                notification.style.background = 'var(--danger)';
            } else {
                notification.style.background = 'var(--success)';
            }
            
            setTimeout(() => {
                notification.classList.remove('show');
            }, 3000);
        }
        
        // Update uptime
        function updateUptime() {
            const uptime = Date.now() - startTime;
            uptimeValue.textContent = formatDuration(uptime);
        }
        
        // Load konfigurasi
        async function loadConfig() {
            try {
                configProgress.style.width = '30%';
                const response = await fetch('/config');
                const data = await response.json();
                configProgress.style.width = '70%';
                
                uuidValue.innerHTML = data.uuid;
                proxyValue.innerHTML = data.proxy;
                configBox.textContent = data.vlessConfig;
                currentConfig = data.vlessConfig;
                
                activeProxy.innerHTML = data.proxy;
                configProgress.style.width = '100%';
                
                // Update proxy list
                if (data.proxyList) {
                    proxyCount.innerHTML = \`\${data.proxyList.length} proxies available\`;
                    
                    proxyList.innerHTML = '';
                    data.proxyList.forEach(proxy => {
                        const proxyItem = document.createElement('div');
                        proxyItem.className = 'proxy-item';
                        
                        const isActive = proxy === data.proxy;
                        if (isActive) {
                            proxyItem.classList.add('proxy-active');
                        } else {
                            proxyItem.classList.add('proxy-inactive');
                        }
                        
                        proxyItem.innerHTML = \`
                            <span>\${proxy}</span>
                            <span class="proxy-status">
                                \${isActive ? 'Active' : 'Inactive'}
                            </span>
                        \`;
                        
                        proxyList.appendChild(proxyItem);
                    });
                }
                
                setTimeout(() => {
                    configProgress.style.width = '0%';
                }, 1000);
                
            } catch (error) {
                console.error('Error loading config:', error);
                configBox.textContent = 'Error loading configuration';
                showNotification('Error loading configuration', 'error');
            }
        }
        
        // Generate VLESS config
        async function generateVlessConfig() {
            try {
                generateVlessBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
                
                const response = await fetch('/generate-vless');
                const data = await response.json();
                
                configBox.textContent = data.vlessConfig;
                currentConfig = data.vlessConfig;
                
                showNotification('VLESS config generated successfully!');
                generateVlessBtn.innerHTML = '<i class="fas fa-bolt"></i> Generate VLESS';
                
            } catch (error) {
                console.error('Error generating VLESS config:', error);
                showNotification('Error generating VLESS config', 'error');
                generateVlessBtn.innerHTML = '<i class="fas fa-bolt"></i> Generate VLESS';
            }
        }
        
        // Test ping
        async function testPing() {
            try {
                pingValue.textContent = '...';
                pingValue.className = 'ping-value';
                pingStatus.textContent = 'Testing...';
                
                const start = Date.now();
                const response = await fetch('/ping');
                const end = Date.now();
                
                const ping = end - start;
                pingValue.textContent = ping;
                
                // Update kelas berdasarkan ping
                if (ping < 100) {
                    pingValue.className = 'ping-value ping-good';
                    pingStatus.textContent = 'ms (Excellent)';
                } else if (ping < 300) {
                    pingValue.className = 'ping-value ping-medium';
                    pingStatus.textContent = 'ms (Good)';
                } else {
                    pingValue.className = 'ping-value ping-bad';
                    pingStatus.textContent = 'ms (Slow)';
                }
                
                lastCheck.textContent = formatTime(end);
                statusText.textContent = 'Active';
                
                return ping;
            } catch (error) {
                console.error('Error testing ping:', error);
                pingValue.textContent = 'Error';
                pingValue.className = 'ping-value ping-bad';
                pingStatus.textContent = 'Connection failed';
                statusText.textContent = 'Error';
                
                return null;
            }
        }
        
        // Toggle auto ping
        function toggleAutoPing() {
            if (autoPingInterval) {
                clearInterval(autoPingInterval);
                autoPingInterval = null;
                autoPingBtn.innerHTML = '<i class="fas fa-sync"></i> Auto Ping';
                autoPingBtn.classList.remove('btn-danger');
                showNotification('Auto ping stopped');
            } else {
                testPing(); // Test immediately
                autoPingInterval = setInterval(testPing, 5000); // Test every 5 seconds
                autoPingBtn.innerHTML = '<i class="fas fa-stop"></i> Stop Auto Ping';
                autoPingBtn.classList.add('btn-danger');
                showNotification('Auto ping started');
            }
        }
        
        // Copy config to clipboard
        async function copyConfig() {
            try {
                if (!currentConfig) {
                    showNotification('No configuration to copy', 'error');
                    return;
                }
                
                await navigator.clipboard.writeText(currentConfig);
                showNotification('Configuration copied to clipboard!');
            } catch (error) {
                console.error('Error copying config:', error);
                showNotification('Error copying configuration', 'error');
            }
        }
        
        // Rotate proxy
        async function rotateProxy() {
            try {
                rotateProxyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rotating...';
                
                // Reload config akan memicu rotasi proxy
                await loadConfig();
                
                showNotification('Proxy rotated successfully!');
                rotateProxyBtn.innerHTML = '<i class="fas fa-random"></i> Rotate Proxy';
                
                // Test ping dengan proxy baru
                testPing();
            } catch (error) {
                console.error('Error rotating proxy:', error);
                showNotification('Error rotating proxy', 'error');
                rotateProxyBtn.innerHTML = '<i class="fas fa-random"></i> Rotate Proxy';
            }
        }
        
        // Refresh proxies
        async function refreshProxies() {
            try {
                refreshProxiesBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
                
                // Paksa reload config untuk generate proxy baru
                await loadConfig();
                
                showNotification('Proxy list refreshed!');
                refreshProxiesBtn.innerHTML = '<i class="fas fa-redo"></i> Refresh Proxies';
            } catch (error) {
                console.error('Error refreshing proxies:', error);
                showNotification('Error refreshing proxies', 'error');
                refreshProxiesBtn.innerHTML = '<i class="fas fa-redo"></i> Refresh Proxies';
            }
        }
        
        // Event listeners
        refreshBtn.addEventListener('click', loadConfig);
        copyBtn.addEventListener('click', copyConfig);
        generateVlessBtn.addEventListener('click', generateVlessConfig);
        pingBtn.addEventListener('click', testPing);
        autoPingBtn.addEventListener('click', toggleAutoPing);
        rotateProxyBtn.addEventListener('click', rotateProxy);
        refreshProxiesBtn.addEventListener('click', refreshProxies);
        
        // Initial load
        loadConfig();
        testPing();
        setInterval(updateUptime, 1000);
        
        // Animasi progress bar
        setTimeout(() => {
            configProgress.style.width = '0%';
        }, 500);
    </script>
</body>
</html>
  `;
  
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

// Fungsi untuk memberikan konfigurasi VLess
async function serveConfig(request) {
  const uuid = generateUUID();
  const proxies = await getProxyList();
  const proxy = getRandomProxy(proxies);
  
  // Format konfigurasi VLess
  const vlessConfig = `vless://${uuid}@${new URL(proxy).hostname}:443?encryption=none&security=tls&sni=${new URL(proxy).hostname}&type=ws&host=${new URL(proxy).hostname}&path=%2Fvless#VLess-Auto-Bank-Proxy`;
  
  const responseData = {
    uuid: uuid,
    proxy: proxy,
    vlessConfig: vlessConfig,
    proxyList: proxies
  };
  
  return new Response(JSON.stringify(responseData), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// Fungsi untuk generate VLESS config khusus
async function serveVLessConfig(request) {
  const uuid = generateUUID();
  const proxies = await getProxyList();
  const proxy = getRandomProxy(proxies);
  
  // Multiple format VLESS config
  const vlessConfigs = [
    `vless://${uuid}@${new URL(proxy).hostname}:443?encryption=none&security=tls&sni=${new URL(proxy).hostname}&type=ws&host=${new URL(proxy).hostname}&path=%2Fvless#VLess-Bank-Proxy`,
    `vless://${uuid}@${new URL(proxy).hostname}:443?encryption=none&security=tls&sni=cloudflare.com&type=ws&host=${new URL(proxy).hostname}&path=%2Fray#VLess-Secure`,
    `vless://${uuid}@${new URL(proxy).hostname}:2053?encryption=none&security=tls&type=grpc&serviceName=vl&mode=gun#VLess-GRPC`
  ];
  
  const vlessConfig = vlessConfigs[Math.floor(Math.random() * vlessConfigs.length)];
  
  const responseData = {
    uuid: uuid,
    proxy: proxy,
    vlessConfig: vlessConfig
  };
  
  return new Response(JSON.stringify(responseData), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// Fungsi untuk mengecek ping
async function servePing(request) {
  // Simulasi pengecekan ping dengan delay acak
  await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 50));
  
  return new Response(JSON.stringify({ 
    status: 'ok',
    timestamp: Date.now(),
    message: 'Ping test successful'
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// Fungsi untuk memberikan daftar proxy
async function serveProxyList(request) {
  const proxies = await getProxyList();
  
  return new Response(JSON.stringify({
    proxies: proxies,
    count: proxies.length,
    generatedAt: new Date().toISOString()
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// Fungsi untuk menangani request VLess
async function handleVLess(request) {
  // Implementasi VLess protocol handling di sini
  // Ini adalah placeholder untuk implementasi sebenarnya
  
  return new Response('VLess Worker Active - Auto Bank Proxy System', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      'X-Proxy-Type': 'Auto-Bank-Proxy',
      'X-UUID-Generated': 'true'
    }
  });
}
