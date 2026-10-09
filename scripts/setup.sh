#!/usr/bin/env bash
# defame-shield 完整环境安装脚本
# 安装 Node 依赖 + (可选) Python 虚拟环境 + markitdown 增强
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# .venv 必须建在仓库根目录 (markitdown-adapter 从包根目录的 .venv 查找二进制, 与运行时 cwd 无关)
cd "$SCRIPT_DIR/.."

echo "================================================"
echo "defame-shield 一键环境安装"
echo "================================================"

# 1. 检查 Node / pnpm
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node 未安装, 请先安装 Node 18+ (https://nodejs.org)"
  exit 1
fi
echo "✓ Node: $(node --version)"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "⚠️  pnpm 未安装, 尝试用 npm..."
  NPM_CMD="npm install"
else
  echo "✓ pnpm: $(pnpm --version)"
  NPM_CMD="pnpm install"
fi

# 2. 安装 Node 依赖
echo ""
echo "▶ 安装 Node 依赖..."
$NPM_CMD

# 3-6. Python 组件 (可选增强): uv venv + markitdown
# pdf/docx 转换走纯 Node 兜底 (mammoth + pdf.js) 即可; markitdown 仅 pptx/xlsx/html/表格增强需要
echo ""
if command -v uv >/dev/null 2>&1; then
  echo "✓ uv: $(uv --version)"

  if [ -d ".venv" ]; then
    echo "✓ .venv 已存在, 跳过创建"
  else
    echo "▶ 创建 Python 虚拟环境 (.venv, Python 3.13)..."
    uv venv .venv --python 3.13
  fi

  echo "▶ 安装 markitdown (版本以 requirements.txt 为准)..."
  uv pip install --python .venv/bin/python -r requirements.txt

  echo "▶ 验证 markitdown..."
  if .venv/bin/markitdown --help >/dev/null 2>&1; then
    echo "✓ markitdown 安装成功 (路径: $SCRIPT_DIR/../.venv/bin/markitdown)"
  else
    echo "❌ markitdown 验证失败"
    exit 1
  fi
else
  echo "⚠️  uv 未安装 — 跳过 Python 组件."
  echo "   基础功能不受影响: pdf/docx 转换自动走纯 Node 兜底;"
  echo "   仅 pptx/xlsx/html/表格增强需要 markitdown, 之后可安装 uv 重跑本脚本:"
  echo "   macOS: brew install uv  或  curl -LsSf https://astral.sh/uv/install.sh | sh"
fi

echo ""
echo "================================================"
echo "✅ 安装完成!"
echo "================================================"
echo ""
echo "下一步:"
echo "  pnpm test              # 跑测试"
echo "  pnpm build             # 编译 TypeScript"
echo "  node bin/dsh.mjs --help    # 查看 CLI"
echo "  node bin/dsh.mjs convert --check  # 查看转换能力 (纯 Node + markitdown)"
echo ""
echo "如需重新安装, 删除 .venv 后重跑: rm -rf .venv && ./scripts/setup.sh"
