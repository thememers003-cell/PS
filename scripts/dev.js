// ============================================================
// XPOS Unified Multi-Service Dev Runner (Zero Out-Of-Memory)
// Starts API, Customer, Kiosk, and Admin with clean memory allocation
// ============================================================

const { spawn } = require('child_process');
const path = require('path');

// Use lightweight 1024MB heap allocation per service to prevent V8 Zone Out-Of-Memory on Windows
process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '').replace(/--max-old-space-size=\d+/g, '') + ' --max-old-space-size=1024';

const rootDir = path.resolve(__dirname, '..');

const services = [
  {
    name: 'API',
    color: '\x1b[35m', // Magenta
    cwd: path.join(rootDir, 'apps', 'api'),
    cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'dev'],
  },
  {
    name: 'Customer',
    color: '\x1b[36m', // Cyan
    cwd: path.join(rootDir, 'apps', 'customer'),
    cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'dev'],
  },
  {
    name: 'Kiosk',
    color: '\x1b[32m', // Green
    cwd: path.join(rootDir, 'apps', 'kiosk'),
    cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'dev'],
  },
  {
    name: 'Admin',
    color: '\x1b[33m', // Yellow
    cwd: path.join(rootDir, 'apps', 'admin'),
    cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'dev'],
  },
];

const resetColor = '\x1b[0m';
const children = [];

function prefixStream(stream, name, color) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop(); // retain partial line
    for (const line of lines) {
      if (line.trim()) {
        console.log(`${color}[${name}]${resetColor} ${line}`);
      }
    }
  });
}

async function startAll() {
  console.log('\n🚀 Starting all XPOS Cloud Services with high-performance memory allocation...\n');

  for (const svc of services) {
    console.log(`⏳ Starting ${svc.name}...`);
    const child = spawn(svc.cmd, svc.args, {
      cwd: svc.cwd,
      env: { ...process.env },
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    });

    prefixStream(child.stdout, svc.name, svc.color);
    prefixStream(child.stderr, svc.name, svc.color);

    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.log(`${svc.color}[${svc.name}]${resetColor} Exited with code ${code}`);
      }
    });

    children.push(child);
    // Stagger starts by 1.8s to avoid memory spikes on Windows V8 compiler
    await new Promise((r) => setTimeout(r, 1800));
  }

  console.log('\n============================================================');
  console.log('✅ All services launched:');
  console.log('   📱 Customer App:     http://localhost:3000');
  console.log('   📊 Admin Portal:     http://localhost:3001');
  console.log('   🖨️  Kiosk Interface:  http://localhost:3002');
  console.log('   ⚡ Backend API:      http://localhost:4000');
  console.log('============================================================\n');
}

function shutdown() {
  console.log('\n🛑 Shutting down all services cleanly...');
  for (const child of children) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', child.pid, '/f', '/t']);
      } else {
        child.kill('SIGINT');
      }
    } catch {}
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startAll();
