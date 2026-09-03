# GitHub 上传与发布指南

本指南以仓库名 `people-efficiency-operating-cockpit` 为例。可按实际项目名称替换。

> 发布前先阅读 [SECURITY.md](../SECURITY.md)。公开仓库中不得上传真实员工、薪酬、绩效、客户、财务明细或任何凭证。

---

## 方式 A：GitHub 网页上传（最简单）

适合首次使用 GitHub、无需安装 Git 的场景。

1. 登录 [GitHub](https://github.com/)；
2. 右上角点击 **+** → **New repository**；
3. 填写：
   - **Repository name**：`people-efficiency-operating-cockpit`
   - **Description**：`业、人、财一体化的人效经营分析与数据闭环离线原型`
   - **Visibility**：
     - 有脱敏疑虑：选择 **Private**；
     - 确认所有文件可公开：选择 **Public**；
4. 建议暂时不要勾选 “Add a README file”，因为本发布包已经包含润色后的 `README.md`；
5. 点击 **Create repository**；
6. 在新仓库页面选择 **uploading an existing file**；
7. 将本发布包根目录中的文件和文件夹全部拖入上传区；
8. 在 Commit message 填写：

   ```text
   feat: 发布 V6.3 真实导入数据驱动原型
   ```

9. 点击 **Commit changes**；
10. 打开仓库首页，确认 README 已自动显示。

### 网页上传注意事项

- 不要把整个云盘工作目录拖进去；只上传 `people-efficiency-operating-cockpit/` 目录中的内容；
- 请保留 `.gitignore`、`SECURITY.md`、`docs/`、`data/templates/`；
- `data/uploads/` 仅保留 `.gitkeep`，不要上传真实业务数据；
- GitHub 网页单文件限制通常为 25 MB；本项目当前文件均远小于该阈值。

---

## 方式 B：Git 命令行上传（推荐）

适合后续持续迭代和版本管理。

### 1. 安装并配置 Git

确认 Git 已安装：

```bash
git --version
```

首次使用时配置署名：

```bash
git config --global user.name "YOUR_NAME"
git config --global user.email "YOUR_EMAIL@example.com"
```

### 2. 在 GitHub 创建空仓库

按“方式 A”的第 1–5 步创建仓库。创建完成后复制仓库 HTTPS 地址，例如：

```text
https://github.com/YOUR_GITHUB_USERNAME/people-efficiency-operating-cockpit.git
```

### 3. 初始化并推送

在终端中进入发布包目录：

```bash
cd /path/to/people-efficiency-operating-cockpit
```

依次执行：

```bash
git init
git branch -M main
git add .
git status
git commit -m "feat: 发布 V6.3 真实导入数据驱动原型"
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/people-efficiency-operating-cockpit.git
git push -u origin main
```

如果 GitHub 要求认证：

- 推荐使用 GitHub Desktop、Git Credential Manager 或浏览器 OAuth；
- 不要在聊天、README、代码或 Git 命令中明文保存 Personal Access Token；
- 如使用 Token，应仅在 GitHub 官方认证窗口或安全凭证管理器中输入。

### 4. 后续更新

```bash
git status
git add .
git commit -m "feat: 描述本次更新"
git push
```

建议提交信息格式：

```text
feat: 新增功能
fix: 修复问题
docs: 更新文档
refactor: 重构代码
chore: 工程配置或维护调整
```

---

## 方式 C：使用 GitHub Desktop

适合希望可视化管理提交记录的场景。

1. 安装并登录 GitHub Desktop；
2. 点击 **File** → **Add Local Repository**；
3. 选择 `people-efficiency-operating-cockpit` 目录；
4. 若目录尚未初始化，点击 **create a repository**；
5. 在左下角填写 Commit message，例如：

   ```text
   feat: 发布 V6.3 真实导入数据驱动原型
   ```

6. 点击 **Commit to main**；
7. 点击 **Publish repository**；
8. 选择 Public 或 Private；
9. 勾选或取消勾选 “Keep this code private” 后完成发布。

---

## 发布 GitHub Pages 原型站点

上传完成后，可以把 `index.html` 发布成在线演示站点。

1. 打开 GitHub 仓库 → **Settings** → **Pages**；
2. 在 **Build and deployment** 选择：
   - Source：`Deploy from a branch`
   - Branch：`main`
   - Folder：`/ (root)`
3. 点击 **Save**；
4. 等待 1–3 分钟，GitHub 会显示访问 URL；
5. 打开 URL，确认 V6.3 原型可用。

> GitHub Pages 只用于展示静态原型。用户在浏览器中选择的本地 Excel 文件不会被自动上传到 GitHub Pages。

---

## 建议的仓库设置

### General

- 描述：`业、人、财一体化的人效经营分析与数据闭环离线原型`；
- Topics：`hr-analytics`、`people-analytics`、`business-intelligence`、`data-governance`、`dashboard`、`prototype`、`excel-import`；
- 默认分支：`main`。

### Branch protection（团队协作时）

建议为 `main` 开启：

- Pull Request 审核；
- 至少 1 名 Reviewer；
- GitHub Actions 校验通过后才可合并；
- 禁止直接 force push。

### Issues

建议建立以下标签：

```text
bug
feature
documentation
data-governance
metric-definition
privacy-security
prototype-ui
prediction
```

---

## 发布前检查清单

- [ ] 已确认仓库选择 Public 或 Private；
- [ ] 已确认 `README.md` 在仓库首页正确渲染；
- [ ] 已确认 `.gitignore` 未被删除；
- [ ] 未包含真实员工、薪酬、绩效、客户、财务明细；
- [ ] 未包含密钥、Token、数据库密码、内部地址；
- [ ] 标准 Excel 模板和示例报告均为可公开的模拟 / 脱敏数据；
- [ ] `npm run validate` 执行通过；
- [ ] 如需公开开源，已由项目 Owner 确认许可证；
- [ ] 如启用 GitHub Pages，已确认页面演示数据不包含敏感信息。
