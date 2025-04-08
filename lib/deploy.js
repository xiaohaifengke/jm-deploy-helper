const execa = require("execa");
const inquirer = require("inquirer");
const ora = require("ora");
const path = require("path");
const fs = require("fs").promises;
const { projectWorkspacePath, projectName } = require("../config/config");
const {
  cleanDirectoryExcept,
  copyDirectory,
  sendDingTalkMarkdown,
  logCommand,
} = require("../utils");
const config = require("../config/index").get();

async function deploy({
  distPath,
  username,
  password,
  remoteUrl,
  remoteBranchName,
  env,
  webhookUrl,
  atMobiles,
  commitMsg,
  announcement,
  startTime,
}) {
  const projectPath = process.cwd();
  const projectDistDir = path.join(projectPath, distPath);
  const gitWorkspace = path.join(projectWorkspacePath, "git-workspace");
  const gitCredentialPath = path.join(projectWorkspacePath, ".git-credential");
  // https://gitee.com/manongjianghu/jm-material.git

  const gitCredentialStr = remoteUrl.replace(
    /(?<=https?:\/\/)\b/,
    `${username}:${password}@`
  );
  console.log("projectWorkspacePath: ", projectWorkspacePath);
  console.log("gitWorkspace: ", gitWorkspace);
  console.log("gitCredentialStr: ", gitCredentialStr);
  console.log("gitCredentialPath: ", gitCredentialPath);
  const spinner = ora({
    text: "正在部署...",
  }).start();

  await ensureGitCredential({
    filePath: gitCredentialPath,
    content: gitCredentialStr,
  });
  try {
    const statusRes = await execaWrapper("git", ["status"], {
      cwd: gitWorkspace,
    });
  } catch (error) {
    // 失败时重新初始化
    removeGitWorkspace(gitWorkspace);
    createGitWorkspace(gitWorkspace);
    await execaWrapper("git", ["init"], { cwd: gitWorkspace });
    await execaWrapper(
      "git",
      ["config", "credential.helper", "store", `--file=../.git-credential`],
      {
        cwd: gitWorkspace,
      }
    );
    await execaWrapper("git", ["remote", "add", "origin", remoteUrl], {
      cwd: gitWorkspace,
    });
  }

  try {
    await execaWrapper("git", ["fetch"], { cwd: gitWorkspace });
    await execaWrapper(
      "git",
      ["checkout", "-B", remoteBranchName, `origin/${remoteBranchName}`],
      { cwd: gitWorkspace }
    );
    await execaWrapper("git", ["pull"], { cwd: gitWorkspace });
    await cleanDirectoryExcept(gitWorkspace, [".git", ".gitignore"]);
    // await execaWrapper("cp", [ '-r', `${projectDistDir}/.`, '.'], { cwd: gitWorkspace });
    // 复制到git workspace的www目录
    await copyDirectory(projectDistDir, path.join(gitWorkspace, "www"), [
      "**.DS_Store",
    ]);
    // await execaWrapper("git", ["status"], { cwd: gitWorkspace });
    await execaWrapper("git", ["add", "."], { cwd: gitWorkspace });
    await execaWrapper("git", ["commit", "-m", commitMsg], {
      cwd: gitWorkspace,
    });
    await execaWrapper("git", ["push"], { cwd: gitWorkspace });

    spinner.succeed("部署成功");
    const endTime = Date.now();
    const duration = Math.ceil(endTime - startTime) / 1000;
    if (announcement) {
      sendDingTalkMarkdown({
        webhookUrl,
        atMobiles,
        succeed: true,
        projectName,
        env,
        username,
        commitMsg,
        duration,
      });
    }
  } catch (e) {
    console.log("部署失败: ", e);
    spinner.fail("部署失败");
    if (announcement) {
      const endTime = Date.now();
      const duration = Math.ceil(endTime - startTime) / 1000;
      sendDingTalkMarkdown({
        webhookUrl: config.failedWebhook,
        atMobiles: config.failedAtMobiles,
        succeed: false,
        failedReason: e.toString?.(),
        projectName,
        env,
        username,
        duration,
      });
    }
  }
  console.log("------------- end -------------");

  async function execaWrapper(...args) {
    logCommand(args);
    try {
      const subprocess = execa(...args);
      subprocess.stdout.pipe(process.stdout);
      const { stdout } = await subprocess;
      // console.log(stdout);
    } catch (error) {
      console.error(args, error);
      throw error;
    }
  }

  async function removeGitWorkspace(gitWorkspace) {
    try {
      await fs.access(gitWorkspace);
      await fs.rm(gitWorkspace, { recursive: true, force: true });
    } catch (err) {
      // console.log(err);
    }
  }

  async function createGitWorkspace(gitWorkspace) {
    await fs.mkdir(gitWorkspace, { recursive: true });
  }
}

async function inquireDeployConfig() {
  const { commitMsg, announcement } = await inquirer.prompt([
    {
      type: "input",
      name: "commitMsg",
      message: `请输入本次部署的描述信息`,
      default: "chore: some chores",
    },
    {
      type: "confirm",
      name: "announcement",
      message: `是否通知本次部署的信息`,
      default: true,
    },
  ]);
  return {
    commitMsg,
    announcement,
  };
}

async function ensureGitCredential({ filePath, content }) {
  try {
    // 检查 .git-credential 文件是否存在
    try {
      await fs.access(filePath);
    } catch (error) {
      // 文件不存在，创建文件并写入内容
      await fs.writeFile(filePath, content, "utf8");
    }
  } catch (error) {
    console.error("Error:", error.message);
  }
}

module.exports = {
  deploy,
  inquireDeployConfig,
};
