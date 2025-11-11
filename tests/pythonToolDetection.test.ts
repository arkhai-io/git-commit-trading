import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { detectProjectCommands } from "../src/test-execution/projectDetection";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Python Tool Detection", () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "python-tool-test-"));
    });

    afterEach(async () => {
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
            console.warn(`Failed to clean up temp directory: ${error}`);
        }
    });

    test("should detect Poetry project from poetry.lock", async () => {
        // Create poetry.lock file
        await fs.writeFile(
            path.join(tempDir, "poetry.lock"),
            "# Poetry lock file content"
        );
        
        // Create a simple Python file
        await fs.writeFile(
            path.join(tempDir, "main.py"),
            "print('hello')"
        );

        const result = await detectProjectCommands(tempDir);

        expect(result.isValidProject).toBe(true);
        expect(result.language).toBe("python");
        expect(result.commands?.installCommand).toBe("poetry install");
        expect(result.commands?.testCommand).toBe("poetry run pytest");
    });

    test("should detect Poetry project from pyproject.toml with [tool.poetry]", async () => {
        // Create pyproject.toml with Poetry configuration
        await fs.writeFile(
            path.join(tempDir, "pyproject.toml"),
            `
[tool.poetry]
name = "test-project"
version = "0.1.0"
description = ""

[tool.poetry.dependencies]
python = "^3.9"
`
        );
        
        await fs.writeFile(
            path.join(tempDir, "main.py"),
            "print('hello')"
        );

        const result = await detectProjectCommands(tempDir);

        expect(result.isValidProject).toBe(true);
        expect(result.language).toBe("python");
        expect(result.commands?.installCommand).toBe("poetry install");
        expect(result.commands?.testCommand).toBe("poetry run pytest");
    });

    test("should detect UV project from uv.lock", async () => {
        // Create uv.lock file
        await fs.writeFile(
            path.join(tempDir, "uv.lock"),
            "# UV lock file content"
        );
        
        await fs.writeFile(
            path.join(tempDir, "main.py"),
            "print('hello')"
        );

        const result = await detectProjectCommands(tempDir);

        expect(result.isValidProject).toBe(true);
        expect(result.language).toBe("python");
        expect(result.commands?.installCommand).toBe("uv sync");
        expect(result.commands?.testCommand).toBe("uv run pytest");
    });

    test("should detect UV project from pyproject.toml with [tool.uv]", async () => {
        // Create pyproject.toml with UV configuration
        await fs.writeFile(
            path.join(tempDir, "pyproject.toml"),
            `
[tool.uv]
dev-dependencies = [
    "pytest>=7.0.0",
]
`
        );
        
        await fs.writeFile(
            path.join(tempDir, "main.py"),
            "print('hello')"
        );

        const result = await detectProjectCommands(tempDir);

        expect(result.isValidProject).toBe(true);
        expect(result.language).toBe("python");
        expect(result.commands?.installCommand).toBe("uv sync");
        expect(result.commands?.testCommand).toBe("uv run pytest");
    });

    test("should detect PDM project from pdm.lock", async () => {
        // Create pdm.lock file
        await fs.writeFile(
            path.join(tempDir, "pdm.lock"),
            "# PDM lock file content"
        );
        
        await fs.writeFile(
            path.join(tempDir, "main.py"),
            "print('hello')"
        );

        const result = await detectProjectCommands(tempDir);

        expect(result.isValidProject).toBe(true);
        expect(result.language).toBe("python");
        expect(result.commands?.installCommand).toBe("pdm install");
        expect(result.commands?.testCommand).toBe("pdm run pytest");
    });

    test("should detect PDM project from pyproject.toml with [tool.pdm]", async () => {
        // Create pyproject.toml with PDM configuration
        await fs.writeFile(
            path.join(tempDir, "pyproject.toml"),
            `
[tool.pdm]
[tool.pdm.dev-dependencies]
test = [
    "pytest>=7.0.0",
]
`
        );
        
        await fs.writeFile(
            path.join(tempDir, "main.py"),
            "print('hello')"
        );

        const result = await detectProjectCommands(tempDir);

        expect(result.isValidProject).toBe(true);
        expect(result.language).toBe("python");
        expect(result.commands?.installCommand).toBe("pdm install");
        expect(result.commands?.testCommand).toBe("pdm run pytest");
    });

    test("should detect Pipenv project from Pipfile", async () => {
        // Create Pipfile
        await fs.writeFile(
            path.join(tempDir, "Pipfile"),
            `
[[source]]
url = "https://pypi.org/simple"
verify_ssl = true
name = "pypi"

[packages]

[dev-packages]
pytest = "*"
`
        );
        
        await fs.writeFile(
            path.join(tempDir, "main.py"),
            "print('hello')"
        );

        const result = await detectProjectCommands(tempDir);

        expect(result.isValidProject).toBe(true);
        expect(result.language).toBe("python");
        expect(result.commands?.installCommand).toBe("pipenv install --dev");
        expect(result.commands?.testCommand).toBe("pipenv run pytest");
    });

    test("should use pip/venv for pyproject.toml without tool-specific sections", async () => {
        // Create generic pyproject.toml
        await fs.writeFile(
            path.join(tempDir, "pyproject.toml"),
            `
[build-system]
requires = ["setuptools>=45", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "test-project"
version = "0.1.0"
`
        );
        
        await fs.writeFile(
            path.join(tempDir, "main.py"),
            "print('hello')"
        );

        const result = await detectProjectCommands(tempDir);

        expect(result.isValidProject).toBe(true);
        expect(result.language).toBe("python");
        expect(result.commands?.installCommand).toContain("python3 -m venv venv");
        expect(result.commands?.installCommand).toContain("venv/bin/pip install");
        expect(result.commands?.testCommand).toBe("venv/bin/python -m pytest");
    });

    test("should use pip/venv for requirements.txt", async () => {
        // Create requirements.txt
        await fs.writeFile(
            path.join(tempDir, "requirements.txt"),
            "pytest>=7.0.0\nrequests>=2.28.0\n"
        );
        
        await fs.writeFile(
            path.join(tempDir, "main.py"),
            "print('hello')"
        );

        const result = await detectProjectCommands(tempDir);

        expect(result.isValidProject).toBe(true);
        expect(result.language).toBe("python");
        expect(result.commands?.installCommand).toContain("python3 -m venv venv");
        expect(result.commands?.installCommand).toContain("venv/bin/pip install -r requirements.txt");
        expect(result.commands?.testCommand).toBe("venv/bin/python -m pytest");
    });

    test("should prioritize poetry.lock over pyproject.toml", async () => {
        // Create both poetry.lock and a generic pyproject.toml
        await fs.writeFile(
            path.join(tempDir, "poetry.lock"),
            "# Poetry lock file"
        );
        
        await fs.writeFile(
            path.join(tempDir, "pyproject.toml"),
            `
[build-system]
requires = ["setuptools>=45"]
build-backend = "setuptools.build_meta"
`
        );
        
        await fs.writeFile(
            path.join(tempDir, "main.py"),
            "print('hello')"
        );

        const result = await detectProjectCommands(tempDir);

        expect(result.isValidProject).toBe(true);
        expect(result.language).toBe("python");
        expect(result.commands?.installCommand).toBe("poetry install");
        expect(result.commands?.testCommand).toBe("poetry run pytest");
    });

    test("should prioritize uv.lock over pyproject.toml", async () => {
        // Create both uv.lock and pyproject.toml
        await fs.writeFile(
            path.join(tempDir, "uv.lock"),
            "# UV lock file"
        );
        
        await fs.writeFile(
            path.join(tempDir, "pyproject.toml"),
            `
[tool.poetry]
name = "test"
`
        );
        
        await fs.writeFile(
            path.join(tempDir, "main.py"),
            "print('hello')"
        );

        const result = await detectProjectCommands(tempDir);

        expect(result.isValidProject).toBe(true);
        expect(result.language).toBe("python");
        // uv.lock takes priority over poetry in pyproject.toml
        expect(result.commands?.installCommand).toBe("uv sync");
        expect(result.commands?.testCommand).toBe("uv run pytest");
    });
});
