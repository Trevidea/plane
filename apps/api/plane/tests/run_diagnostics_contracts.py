"""Run diagnostics contracts on disposable private Docker services, never a developer DB."""

import os
from pathlib import Path
import subprocess
import time
from uuid import uuid4


def main():
    root = Path(__file__).resolve().parents[2]
    tools = Path(os.environ.get("API_TEST_TOOLS", root.parents[2] / "kanavio-player-mobile/tmp/api-test-tools"))
    image = os.environ.get(
        "API_TEST_IMAGE", "drakesoftware/plane-api-amd64:sha-99b2f04cae-merge-2c4d0892b1-dirty-20261030"
    )
    prefix = "kanavio-workflow-contracts-" + uuid4().hex[:10]
    containers = []

    def run(*args, **kwargs):
        return subprocess.run(args, check=True, text=True, timeout=240, **kwargs)

    run("docker", "image", "inspect", image, stdout=subprocess.DEVNULL)
    if not tools.is_dir():
        raise SystemExit("Set API_TEST_TOOLS to the existing pytest dependencies directory.")
    run("docker", "network", "create", "--internal", prefix, stdout=subprocess.DEVNULL)
    try:
        for name, container_image, options in (
            (
                prefix + "-db",
                "postgres:15.7-alpine",
                [
                    "--memory",
                    "512m",
                    "-e",
                    "POSTGRES_USER=plane",
                    "-e",
                    "POSTGRES_PASSWORD=disposable",
                    "-e",
                    "POSTGRES_DB=plane",
                    "--tmpfs",
                    "/var/lib/postgresql/data",
                ],
            ),
            (prefix + "-redis", "valkey/valkey:7.2.11-alpine", ["--memory", "128m", "--tmpfs", "/data"]),
        ):
            run(
                "docker",
                "run",
                "-d",
                "--name",
                name,
                "--network",
                prefix,
                *options,
                container_image,
                stdout=subprocess.DEVNULL,
            )
            containers.append(name)
        for _ in range(30):
            if (
                subprocess.run(
                    ["docker", "exec", prefix + "-db", "pg_isready", "-U", "plane"], capture_output=True
                ).returncode
                == 0
            ):
                break
            time.sleep(1)
        run(
            "docker",
            "run",
            "--rm",
            "--network",
            prefix,
            "--memory",
            "2g",
            "--read-only",
            "--tmpfs",
            "/tmp",
            "-v",
            f"{root}:/code:ro",
            "-v",
            f"{tools}:/test-tools:ro",
            "-e",
            "PYTHONPATH=/test-tools:/code",
            "-e",
            f"DATABASE_URL=postgresql://plane:disposable@{prefix}-db:5432/plane",
            "-e",
            f"REDIS_URL=redis://{prefix}-redis:6379/0",
            "-e",
            "SECRET_KEY=disposable-test-only",
            "-e",
            "WEB_URL=https://testserver",
            "-e",
            "APP_BASE_URL=https://testserver",
            "-e",
            "DEBUG=0",
            image,
            "python",
            "-m",
            "pytest",
            "plane/tests/contract/app/test_workspace_diagnostics.py",
            "plane/tests/contract/app/test_operation_diagnostics.py",
            "--create-db",
            "-o",
            "cache_dir=/tmp/pytest-cache",
            "-q",
        )
    finally:
        for name in reversed(containers):
            subprocess.run(["docker", "rm", "-f", name], check=False, stdout=subprocess.DEVNULL)
        subprocess.run(["docker", "network", "rm", prefix], check=False, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
