import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';

const execAsync = promisify(exec);

export interface ContainerPoolConfig {
  poolSize: number;
  imageName?: string; // Optional, will be generated based on framework
  containerPrefix: string;
  resetStrategy: 'restart' | 'cleanup';
}

export interface ContainerBuildArgs {
  dockerfilePath: string;
  sourceRepo: string;
  sourceCommit: string;
  testRepo: string;
  testCommit: string;
}

export interface Container {
  id: string;
  name: string;
  inUse: boolean;
  imageName?: string; // Track which image this container uses
}

export class ContainerPool {
  private config: ContainerPoolConfig;
  private containers: Container[] = [];
  private initialized: boolean = false;

  constructor(config: Partial<ContainerPoolConfig> = {}) {
    this.config = {
      poolSize: config.poolSize || 5,
      imageName: config.imageName, // Optional, will be set during build
      containerPrefix: config.containerPrefix || 'test-executor',
      resetStrategy: config.resetStrategy || 'cleanup',
    };
  }

  /**
   * Initialize the pool (no longer creates containers upfront)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log(chalk.yellow('Container pool already initialized'));
      return;
    }

    this.initialized = true;
    console.log(chalk.green(`✅ Container pool manager ready (max containers: ${this.config.poolSize})`));
    console.log(chalk.gray('Containers will be created on-demand as needed'));
  }

  /**
   * Build a framework-specific container with repo information baked in
   * Waits if pool is at capacity with all containers busy
   */
  async buildAndRunContainer(buildArgs: ContainerBuildArgs): Promise<Container> {
    if (!this.initialized) {
      throw new Error('Container pool not initialized. Call initialize() first.');
    }

    // Wait until we can create a container (if at capacity)
    await this.waitForCapacity();

    const imageName = `git-test-executor:${Date.now()}`;
    const containerName = `${this.config.containerPrefix}-${Date.now()}`;

    console.log(chalk.cyan(`Building container with ${buildArgs.dockerfilePath}...`));

    try {
      // Build image with build args
      const buildCommand = `docker build \
        -f ${buildArgs.dockerfilePath} \
        --build-arg SOURCE_REPO=${buildArgs.sourceRepo} \
        --build-arg SOURCE_COMMIT=${buildArgs.sourceCommit} \
        --build-arg TEST_REPO=${buildArgs.testRepo} \
        --build-arg TEST_COMMIT=${buildArgs.testCommit} \
        -t ${imageName} \
        .`;

      console.log(chalk.gray(`  Building image: ${imageName}`));
      await execAsync(buildCommand, { maxBuffer: 50 * 1024 * 1024 });
      console.log(chalk.green(`✅ Image built successfully`));

      // Run container
      const { stdout } = await execAsync(`docker run -d --name ${containerName} ${imageName}`);
      const containerId = stdout.trim();

      console.log(chalk.green(`✅ Container started: ${containerName}`));

      const container: Container = {
        id: containerId,
        name: containerName,
        inUse: true,
        imageName
      };

      // Track this container
      this.trackContainer(container);

      return container;
    } catch (error) {
      console.error(chalk.red(`Failed to build and run container:`), error);
      throw error;
    }
  }

  /**
   * Wait until there's capacity to create a new container
   * This blocks if we're at max capacity and all containers are busy
   */
  private async waitForCapacity(timeoutMs: number = 300000): Promise<void> {
    if (this.canCreateMoreContainers()) {
      return; // We have capacity
    }

    console.log(chalk.yellow(`Pool at capacity (${this.containers.length}/${this.config.poolSize} containers), waiting for a slot...`));
    
    const startTime = Date.now();
    
    while (true) {
      // Check if any container finished and was cleaned up
      if (this.canCreateMoreContainers()) {
        console.log(chalk.green('Capacity available, proceeding...'));
        return;
      }

      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(
          `Timeout waiting for container capacity after ${timeoutMs}ms. ` +
          `Pool status: ${this.containers.length}/${this.config.poolSize} containers active. ` +
          `Please wait for existing tests to complete or increase the pool size.`
        );
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /**
   * Execute the tests in a built container (just runs the CMD)
   */
  async runTestsInContainer(container: Container): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    console.log(chalk.cyan(`Running tests in container ${container.name}...`));
    
    try {
      // Get container logs (the test output)
      const { stdout, stderr } = await execAsync(`docker logs ${container.name}`, {
        maxBuffer: 10 * 1024 * 1024,
      });

      // Check container exit code
      const { stdout: inspectOutput } = await execAsync(
        `docker inspect --format='{{.State.ExitCode}}' ${container.name}`
      );
      const exitCode = parseInt(inspectOutput.trim(), 10);

      console.log(chalk.gray(`  Container ${container.name} finished with exit code ${exitCode}`));

      return {
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: exitCode || 0,
      };
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message || '',
        exitCode: error.code || 1,
      };
    }
  }

  /**
   * Cleanup a one-time container and its image
   */
  async cleanupContainer(container: Container): Promise<void> {
    try {
      // Remove container
      await execAsync(`docker rm -f ${container.name}`).catch(() => {});
      console.log(chalk.gray(`  Removed container: ${container.name}`));

      // Remove image if it was dynamically created
      if (container.imageName && container.imageName.includes(':')) {
        await execAsync(`docker rmi -f ${container.imageName}`).catch(() => {});
        console.log(chalk.gray(`  Removed image: ${container.imageName}`));
      }

      // Remove from tracking
      const index = this.containers.findIndex(c => c.id === container.id);
      if (index !== -1) {
        this.containers.splice(index, 1);
        console.log(chalk.gray(`  Removed from pool (${this.containers.length}/${this.config.poolSize} remaining)`));
      }
    } catch (error) {
      console.log(chalk.yellow(`  Warning: Could not cleanup container ${container.name}`));
    }
  }

  /**
   * Track a container that was created
   */
  private trackContainer(container: Container): void {
    // Check if we've reached the pool size limit
    if (this.containers.length >= this.config.poolSize) {
      console.log(chalk.yellow(`⚠️  Container pool limit reached (${this.config.poolSize})`));
    }
    
    // Add to tracking list
    this.containers.push(container);
    console.log(chalk.gray(`  Tracking ${this.containers.length}/${this.config.poolSize} containers`));
  }

  /**
   * Check if we can create more containers
   */
  private canCreateMoreContainers(): boolean {
    return this.containers.length < this.config.poolSize;
  }

  async executeInContainer(
    container: Container,
    command: string,
    workingDir?: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const workDirFlag = workingDir ? `-w ${workingDir}` : '';
    const dockerCommand = `docker exec ${workDirFlag} ${container.name} sh -c "${command.replace(/"/g, '\\"')}"`;
    
    try {
      const { stdout, stderr } = await execAsync(dockerCommand, {
        maxBuffer: 10 * 1024 * 1024,
      });
      
      return {
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0,
      };
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message || '',
        exitCode: error.code || 1,
      };
    }
  }

  async copyToContainer(
    container: Container,
    sourcePath: string,
    destPath: string
  ): Promise<void> {
    try {
      await execAsync(`docker cp "${sourcePath}" ${container.name}:${destPath}`);
      console.log(chalk.gray(`  Copied ${sourcePath} to container ${container.name}:${destPath}`));
    } catch (error) {
      console.error(chalk.red(`Failed to copy to container ${container.name}:`), error);
      throw error;
    }
  }

  async copyFromContainer(
    container: Container,
    sourcePath: string,
    destPath: string
  ): Promise<void> {
    try {
      await execAsync(`docker cp ${container.name}:${sourcePath} "${destPath}"`);
      console.log(chalk.gray(`  Copied from container ${container.name}:${sourcePath} to ${destPath}`));
    } catch (error) {
      console.error(chalk.red(`Failed to copy from container ${container.name}:`), error);
      throw error;
    }
  }

  async destroy(): Promise<void> {
    console.log(chalk.cyan('Destroying container pool...'));

    for (const container of this.containers) {
      try {
        await execAsync(`docker rm -f ${container.name}`);
        console.log(chalk.gray(`  Removed container: ${container.name}`));
      } catch (error: any) {
        // Ignore "already in progress" errors as they're harmless
        if (error.stderr && error.stderr.includes('already in progress')) {
          console.log(chalk.gray(`  Container ${container.name} removal already in progress`));
        } else {
          console.log(chalk.yellow(`  Warning: Could not remove container ${container.name}`));
        }
      }
    }

    this.containers = [];
    this.initialized = false;
    console.log(chalk.green('✅ Container pool destroyed'));
  }

  getStatus(): { total: number; inUse: number; available: number } {
    const inUse = this.containers.filter(c => c.inUse).length;
    return {
      total: this.containers.length,
      inUse,
      available: this.containers.length - inUse,
    };
  }
}
