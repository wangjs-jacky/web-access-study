#!/usr/bin/env node
/**
 * 掘金小册提取脚本
 * 用法：node extract-juejin-booklet.mjs <booklet_url_or_id> [--output-dir <path>] [--download-images] [--cookie <cookie_string>]
 *
 * 功能：
 * 1. 调用掘金 API 获取小册元数据和所有章节内容
 * 2. 保存为 Markdown 文件
 * 3. 可选：下载所有图片到本地
 * 4. 支持付费小册（需要提供登录 Cookie）
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

// ========== 配置 ==========
const API_BASE = 'https://api.juejin.cn';
const REQUEST_DELAY = 300; // 请求间隔 ms，避免频率限制

// ========== 工具函数 ==========

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchJSON(url, body, cookie = '') {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'Origin': 'https://juejin.cn',
      'Referer': 'https://juejin.cn/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    };
    if (cookie) {
      headers['Cookie'] = cookie;
    }

    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers,
    };

    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', chunk => chunks += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(chunks));
        } catch (e) {
          reject(new Error(`JSON 解析失败: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const file = fs.createWriteStream(destPath);
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
      // 处理重定向
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(destPath);
      });
    }).on('error', (e) => {
      fs.unlinkSync(destPath);
      reject(e);
    });
  });
}

/**
 * 从 Markdown 内容中提取所有图片 URL
 */
function extractImageUrls(markdown) {
  const urls = [];
  // 匹配 ![alt](url) 格式
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = imgRegex.exec(markdown)) !== null) {
    urls.push({ alt: match[1], url: match[2] });
  }
  // 匹配 <img src="..."> 格式
  const htmlImgRegex = /<img[^>]+src=["']([^"']+)["']/g;
  while ((match = htmlImgRegex.exec(markdown)) !== null) {
    urls.push({ alt: '', url: match[1] });
  }
  return urls;
}

/**
 * 生成安全的文件名
 */
function safeFilename(name, maxLen = 60) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, maxLen)
    .replace(/-+$/, '');
}

// ========== 主逻辑 ==========

/**
 * 解析 booklet ID
 */
function parseBookletId(input) {
  // 完整 URL: https://juejin.cn/book/7304230207953567755/section/xxx
  const urlMatch = input.match(/juejin\.cn\/book\/(\d+)/);
  if (urlMatch) return { bookletId: urlMatch[1] };

  // 纯数字 ID
  if (/^\d+$/.test(input.trim())) return { bookletId: input.trim() };

  throw new Error(`无法解析 booklet ID: ${input}`);
}

/**
 * 获取小册基本信息
 */
async function fetchBookletInfo(bookletId, cookie = '') {
  console.log(`📖 获取小册信息: ${bookletId}`);
  const res = await fetchJSON(`${API_BASE}/booklet_api/v1/booklet/get`, {
    booklet_id: bookletId,
  }, cookie);

  if (res.err_no !== 0) {
    throw new Error(`API 错误: ${res.err_msg}`);
  }

  const { booklet } = res.data;
  const sectionIds = booklet.base_info.section_ids.split('|').filter(Boolean);

  return {
    id: booklet.base_info.booklet_id,
    title: booklet.base_info.title,
    summary: booklet.base_info.summary,
    coverImg: booklet.base_info.cover_img,
    sectionCount: booklet.base_info.section_count,
    sectionIds,
    authorName: booklet.user_info?.user_name || '',
    buyCount: booklet.base_info.buy_count,
  };
}

/**
 * 获取单个章节内容
 */
async function fetchSection(sectionId, cookie = '') {
  const res = await fetchJSON(`${API_BASE}/booklet_api/v1/section/get`, {
    section_id: sectionId,
  }, cookie);

  if (res.err_no !== 0) {
    throw new Error(`章节 API 错误 (${sectionId}): ${res.err_msg}`);
  }

  return res.data.section;
}

/**
 * 获取所有章节
 */
async function fetchAllSections(sectionIds, cookie = '', onProgress) {
  const sections = [];
  for (let i = 0; i < sectionIds.length; i++) {
    const section = await fetchSection(sectionIds[i], cookie);
    sections.push(section);
    if (onProgress) onProgress(i + 1, sectionIds.length, section.title);
    if (i < sectionIds.length - 1) await sleep(REQUEST_DELAY);
  }
  return sections;
}

/**
 * 下载章节中的所有图片
 */
async function downloadSectionImages(markdownContent, imagesDir, sectionIndex) {
  const urls = extractImageUrls(markdownContent);
  if (urls.length === 0) return { downloaded: 0, mapping: {} };

  let downloaded = 0;
  const mapping = {}; // 原始 URL → 本地路径

  for (let i = 0; i < urls.length; i++) {
    const { url, alt } = urls[i];
    try {
      // 生成文件名
      const ext = path.extname(new URL(url).pathname).split('?')[0] || '.png';
      const filename = `${String(sectionIndex).padStart(2, '0')}-${i + 1}${ext}`;
      const localPath = path.join(imagesDir, filename);

      // 跳过已存在的文件
      if (fs.existsSync(localPath)) {
        mapping[url] = `./images/${filename}`;
        downloaded++;
        continue;
      }

      await downloadFile(url, localPath);
      mapping[url] = `./images/${filename}`;
      downloaded++;
    } catch (e) {
      console.warn(`  ⚠️ 图片下载失败: ${url} - ${e.message}`);
    }
  }

  // 替换 Markdown 中的图片 URL
  let updatedContent = markdownContent;
  for (const [originalUrl, localPath] of Object.entries(mapping)) {
    updatedContent = updatedContent.replaceAll(originalUrl, localPath);
  }

  return { downloaded, mapping, updatedContent };
}

/**
 * 保存章节为 Markdown 文件
 */
function saveSectionAsMarkdown(section, index, outputDir, bookletTitle) {
  const title = section.title || `第${index}章`;
  const content = section.markdown_content || section.content || '';
  const filename = `${String(index).padStart(2, '0')}-${safeFilename(title)}.md`;
  const filepath = path.join(outputDir, filename);

  const frontmatter = [
    '---',
    `title: "${title}"`,
    `booklet: "${bookletTitle}"`,
    `section_id: "${section.section_id}"`,
    `section_index: ${index}`,
    `date: "${new Date().toISOString().split('T')[0]}"`,
    `tags: ["掘金小册", "${bookletTitle}"]`,
    '---',
    '',
  ].join('\n');

  const fullContent = frontmatter + content;
  fs.writeFileSync(filepath, fullContent, 'utf8');

  return { filepath, filename, hasContent: content.length > 0 };
}

/**
 * 生成小册索引
 */
function generateIndex(bookletInfo, sections, outputDir) {
  const lines = [
    '---',
    `title: "${bookletInfo.title}"`,
    `booklet_id: "${bookletInfo.id}"`,
    `author: "${bookletInfo.authorName}"`,
    `section_count: ${bookletInfo.sectionCount}`,
    `source: "https://juejin.cn/book/${bookletInfo.id}"`,
    `date: "${new Date().toISOString().split('T')[0]}"`,
    `tags: ["掘金小册"]`,
    '---',
    '',
    `# ${bookletInfo.title}`,
    '',
    `> ${bookletInfo.summary}`,
    '',
    `- **作者**: ${bookletInfo.authorName}`,
    `- **章节数**: ${bookletInfo.sectionCount}`,
    `- **阅读量**: ${bookletInfo.buyCount}`,
    `- **来源**: [掘金小册](https://juejin.cn/book/${bookletInfo.id})`,
    '',
    '## 目录',
    '',
  ];

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const title = s.title || `第${i + 1}章`;
    const filename = `${String(i + 1).padStart(2, '0')}-${safeFilename(title)}.md`;
    lines.push(`${i + 1}. [${title}](./${encodeURIComponent(filename)})`);
  }

  fs.writeFileSync(path.join(outputDir, 'README.md'), lines.join('\n'), 'utf8');
}

// ========== 入口 ==========

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('用法: node extract-juejin-booklet.mjs <booklet_url_or_id> [--output-dir <path>] [--download-images] [--cookie <cookie_string>]');
    process.exit(1);
  }

  // 解析参数
  let bookletInput = args[0];
  let outputDir = null;
  let downloadImages = false;
  let cookie = '';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--output-dir' && args[i + 1]) {
      outputDir = args[++i];
    } else if (args[i] === '--download-images') {
      downloadImages = true;
    } else if (args[i] === '--cookie' && args[i + 1]) {
      cookie = args[++i];
    } else if (args[i] === '--cookie-file' && args[i + 1]) {
      // 从文件读取 cookie（方便传递长字符串）
      const cookieFile = args[++i];
      cookie = fs.readFileSync(cookieFile, 'utf8').trim();
    }
  }

  // 解析 booklet ID
  const { bookletId } = parseBookletId(bookletInput);

  // 获取小册信息
  const bookletInfo = await fetchBookletInfo(bookletId, cookie);
  if (cookie) console.log('   使用 Cookie 认证（付费小册模式）');
  console.log(`\n📚 ${bookletInfo.title}`);
  console.log(`   作者: ${bookletInfo.authorName}`);
  console.log(`   章节: ${bookletInfo.sectionCount} | ID数: ${bookletInfo.sectionIds.length}`);

  // 设置输出目录
  const slug = safeFilename(bookletInfo.title);
  const finalOutputDir = outputDir || path.join(process.cwd(), slug);
  const imagesDir = path.join(finalOutputDir, 'images');

  if (!fs.existsSync(finalOutputDir)) fs.mkdirSync(finalOutputDir, { recursive: true });
  if (downloadImages && !fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  // 下载封面图
  if (downloadImages && bookletInfo.coverImg) {
    try {
      const coverExt = path.extname(new URL(bookletInfo.coverImg).pathname).split('?')[0] || '.png';
      await downloadFile(bookletInfo.coverImg, path.join(imagesDir, `cover${coverExt}`));
      console.log('   封面图已下载');
    } catch (e) {
      console.warn(`   封面图下载失败: ${e.message}`);
    }
  }

  // 获取所有章节
  console.log(`\n📝 开始提取 ${bookletInfo.sectionIds.length} 个章节...`);
  const sections = await fetchAllSections(bookletInfo.sectionIds, cookie, (current, total, title) => {
    process.stdout.write(`\r   [${current}/${total}] ${title}`.substring(0, 80));
  });
  console.log('\n');

  // 保存章节
  let savedCount = 0;
  let totalImages = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    let content = section.markdown_content || section.content || '';

    // 下载图片
    if (downloadImages && content) {
      const result = await downloadSectionImages(content, imagesDir, i + 1);
      content = result.updatedContent || content;
      totalImages += result.downloaded;
      // 更新 section 对象以使用替换后的内容
      if (section.markdown_content) {
        section.markdown_content = content;
      } else {
        section.content = content;
      }
    }

    const result = saveSectionAsMarkdown(section, i + 1, finalOutputDir, bookletInfo.title);
    if (result.hasContent) savedCount++;
  }

  // 生成索引
  generateIndex(bookletInfo, sections, finalOutputDir);

  // 输出摘要
  console.log('========== 提取完成 ==========');
  console.log(`📚 小册: ${bookletInfo.title}`);
  console.log(`📝 章节: ${savedCount}/${sections.length} 篇已保存`);
  if (downloadImages) {
    console.log(`🖼️  图片: ${totalImages} 张已下载`);
  }
  console.log(`📁 目录: ${finalOutputDir}`);
  console.log('================================');
}

main().catch(err => {
  console.error('❌ 提取失败:', err.message);
  process.exit(1);
});
