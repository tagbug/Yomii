# Yomii：自托管静态小说阅读站

Yomii 是一个轻量、纯粹且尊重隐私的单本小说静态阅读站点生成器。基于 Astro + TypeScript 现代化工程栈构建，随项目附带示例短篇《风经过的地方》（共 3 话）。

## 特色特性

- **现代静态工程**：基于 Astro 纯静态（SSG）生成，构建速度极快，SEO 友好，支持本地 HMR 开发。
- **纯粹无干扰阅读**：单栏正文排版，支持 4 种精调主题（随系统 / 清白 / 纸色 / 夜读）、字号、行距、版心宽度及宋体/黑体切换。
- **零 FOUC（无闪烁）**：首屏同步执行偏好注入，深浅色切换毫秒级生效，杜绝白屏/黑屏闪烁。
- **高精度段落记忆**：基于二分查找算法精确记忆视口段落与相对比例，屏幕缩放或字号调整后依然精准恢复阅读进度。
- **书签与撤销机制**：阅读中一键记录书签与摘录，支持 8 秒防误删撤销。
- **沉浸专注模式**：支持快捷键 `F` 进入/退出专注阅读，隐藏一切非必要元素。
- **无障碍与键盘导航**：左右方向键翻页、`F` 专注、`Esc` 退出、严格的 44px 移动端触控标准与 ARIA 规范支持。
- **隐私与本地优先**：所有数据存放于读者本地 `localStorage`，零第三方追踪、零 Cookie、零外部网络依赖，内置严苛 CSP。
- **源文件下载**：支持源 TXT 文本文件下载与 SHA-256 校验。

---

## 快速上手

本项目使用 [Bun](https://bun.sh) 作为 JavaScript/TypeScript 运行时。

### 1. 安装依赖

```sh
bun install
```

### 2. 本地开发与预览

启动带热重载（HMR）的本地开发服务：

```sh
bun run dev
```

本地浏览器访问终端提示的地址（通常为 `http://localhost:4321/`）。

### 3. 构建静态产物

```sh
bun run build
```

构建结果将直接输出到 `dist/` 目录。

### 4. 自动化测试与完整性检查

```sh
bun run test
```

自动化检查包括所有页面的死链检测、重复 ID 检测、锚点有效性及 TXT 下载一致性验证。

---

## 内容导入与配置说明

### 1. 快速导入任意小说

可使用导入脚本自动解析任意 TXT 小说，自动提取元数据并生成站点配置与静态产物：

```sh
bun run import <path-to-novel.txt>
```

支持可选参数覆盖元数据：
```sh
bun run import ./my-novel.txt --title "书名" --author "作者" --site-name "站点名称"
```

解析器支持的格式包括：
- **章节标记**：`第X章/话/节/回`（支持阿拉伯数字与中文数字）、`Chapter X`、`序章`、`尾声`、`后记` 等。
- **分卷标记（可选）**：`【TrackX：卷名】`、`第X卷 卷名`、`卷X 卷名` 等。
- **编码自适应**：支持 UTF-8（含 BOM）及 GB18030 / GBK 编码文本。

### 2. 手动配置 (`config.json`)

```json
{
  "site_name": "Yomii",
  "source": "content/novel.txt",
  "book_title": "",
  "author": "",
  "base_path": ""
}
```

- `site_name`：站点名称，默认 `Yomii`。
- `source`：小说文本路径（相对项目根目录）。
- `book_title` / `author`：留空时将自动从文本前两行提取。
- `base_path`：部署子路径（如 `/read`）。根目录部署请保持为空。

---

## 部署方案

### 方案 A：Cloudflare Pages / Vercel（推荐）

1. 连接 Git 仓库。
2. 构建命令填 `bun run build`，输出目录填 `dist`。
3. 项目已在 `public/_headers` 中预置了适用于 Cloudflare Pages 的安全标头与缓存策略。

### 方案 B：独立服务器（Caddy / Nginx）

将 `dist/` 目录中的全部文件上传到 Web 服务器根目录即可：

- **Caddy** 配置参考 `deploy/Caddyfile`。
- **Nginx** 配置参考 `deploy/nginx.conf`。

---

## 开源许可

本项目基于 MIT 许可协议开源，详见 [LICENSE](./LICENSE)。
