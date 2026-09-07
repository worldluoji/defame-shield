#!/usr/bin/env bash
# defame-shield 完整环境安装脚本
# 安装 Node 依赖 + Python 虚拟环境 + markitdown
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

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

# 3. 检查 uv (Python 包管理)
if ! command -v uv >/dev/null 2>&1; then
  echo ""
  echo "❌ uv 未安装, 请先安装 uv (https://docs.astral.sh/uv/)"
  echo "   macOS: brew install uv"
  echo "   或: curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi
echo "✓ uv: $(uv --version)"

# 4. 创建 Python 虚拟环境
if [ -d ".venv" ]; then
  echo "✓ .venv 已存在, 跳过创建"
else
  echo ""
  echo "▶ 创建 Python 虚拟环境 (.venv, Python 3.13)..."
  uv venv .venv --python 3.13
fi

# 5. 安装 markitdown
echo ""
echo "▶ 安装 markitdown[pdf,docx]..."
uv pip install --python .venv/bin/python "markitdown[pdf,docx]>=0.1.0a1"

# 6. 验证
echo ""
echo "▶ 验证 markitdown..."
if .venv/bin/markitdown --help >/dev/null 2>&1; then
  echo "✓ markitdown 安装成功"
  echo "  路径: $SCRIPT_DIR/.venv/bin/markitdown"
else
  echo "❌ markitdown 验证失败"
  exit 1
fi

echo ""
echo "================================================"
echo "✅ 安装完成!"
echo "================================================"
echo ""
echo "下一步:"
echo "  pnpm test              # 跑测试 (111 个)"
echo "  pnpm build             # 编译 TypeScript"
echo "  node bin/dsh.mjs --help    # 查看 CLI"
echo "  node bin/dsh.mjs convert --check  # 验证 markitdown"
echo ""
echo "如需重新安装, 删除 .venv 后重跑: rm -rf .venv && ./scripts/setup.sh"
