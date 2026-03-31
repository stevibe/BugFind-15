import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const verificationDir = path.join(repoRoot, "verification");
const imageName = process.env.BUGFIND_VERIFY_IMAGE || "bugfind15-verifier";
const containerName = process.env.BUGFIND_VERIFY_CONTAINER || "bugfind15-verifier-service";
const sandboxPort = process.env.BUGFIND_SANDBOX_PORT || "4010";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        ...(options.env ?? {})
      }
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function runOptional(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: options.stdio ?? "ignore",
      env: {
        ...process.env,
        ...(options.env ?? {})
      }
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

async function buildImage() {
  await run("docker", ["build", "-t", imageName, "-f", "Dockerfile", "."], {
    cwd: verificationDir
  });
}

async function imageExists() {
  return runOptional("docker", ["image", "inspect", imageName]);
}

async function containerExists() {
  return runOptional("docker", ["container", "inspect", containerName]);
}

async function ensureImageBuilt() {
  if (await imageExists()) {
    return;
  }

  console.log(`Docker image "${imageName}" not found. Building it now...`);
  await buildImage();
}

async function runVerifier(extraArgs) {
  await run("docker", [
    "run",
    "--rm",
    "--entrypoint",
    "node",
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:exec,mode=1777",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "256",
    "--memory",
    "1024m",
    "--cpus",
    "2",
    imageName,
    "/opt/verification/runner.mjs",
    ...extraArgs
  ]);
}

async function serveVerifier() {
  await ensureImageBuilt();

  if (await containerExists()) {
    await run("docker", ["rm", "-f", containerName]);
  }

  await run("docker", [
    "run",
    "--rm",
    "--name",
    containerName,
    "-p",
    `${sandboxPort}:4010`,
    "--read-only",
    "--tmpfs",
    "/tmp:exec,mode=1777",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "256",
    "--memory",
    "1024m",
    "--cpus",
    "2",
    imageName
  ]);
}

async function stopVerifier() {
  if (!(await containerExists())) {
    console.log(`No running container named "${containerName}".`);
    return;
  }

  await run("docker", ["rm", "-f", containerName]);
}

async function main() {
  const [command = "run", ...rest] = process.argv.slice(2);

  if (command === "build") {
    await buildImage();
    return;
  }

  if (command === "run") {
    await runVerifier(rest);
    return;
  }

  if (command === "rebuild") {
    await buildImage();
    await runVerifier(rest);
    return;
  }

  if (command === "serve") {
    await serveVerifier();
    return;
  }

  if (command === "stop") {
    await stopVerifier();
    return;
  }

  throw new Error(`Unknown command "${command}". Use build, run, rebuild, serve, or stop.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
