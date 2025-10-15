# Paper Burner X - Windows 一键部署脚本
# PowerShell

Write-Host ""
Write-Host "======================================" -ForegroundColor Blue
Write-Host "   Paper Burner X - 一键部署脚本" -ForegroundColor Blue
Write-Host "======================================" -ForegroundColor Blue
Write-Host ""

# 1. 检查 .env 文件
Write-Host "[1/6] 检查配置文件..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    Write-Host "→ 创建 .env 文件" -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "⚠️  请编辑 .env 文件并配置以下必要项：" -ForegroundColor Red
    Write-Host "   - DB_PASSWORD"
    Write-Host "   - JWT_SECRET"
    Write-Host "   - ADMIN_EMAIL"
    Write-Host "   - ADMIN_PASSWORD"
    Write-Host ""
    Read-Host "配置完成后按回车继续"
}
Write-Host "✓ 配置文件检查完成" -ForegroundColor Green
Write-Host ""

# 2. 安装后端依赖
Write-Host "[2/6] 安装后端依赖..." -ForegroundColor Yellow
Set-Location server
if (-not (Test-Path "node_modules")) {
    npm install
    Write-Host "✓ 依赖安装完成" -ForegroundColor Green
} else {
    Write-Host "✓ 依赖已存在" -ForegroundColor Green
}
Set-Location ..
Write-Host ""

# 3. 生成 Prisma Client
Write-Host "[3/6] 生成 Prisma Client..." -ForegroundColor Yellow
Set-Location server
npx prisma generate
Write-Host "✓ Prisma Client 生成完成" -ForegroundColor Green
Set-Location ..
Write-Host ""

# 4. 启动 Docker 服务
Write-Host "[4/6] 启动 Docker 服务..." -ForegroundColor Yellow
docker-compose up -d postgres
Write-Host "→ 等待数据库启动..." -ForegroundColor Yellow
Start-Sleep -Seconds 5
Write-Host "✓ 数据库已启动" -ForegroundColor Green
Write-Host ""

# 5. 运行数据库迁移
Write-Host "[5/6] 初始化数据库..." -ForegroundColor Yellow
Set-Location server
npx prisma migrate deploy
Write-Host "✓ 数据库初始化完成" -ForegroundColor Green
Set-Location ..
Write-Host ""

# 6. 启动应用
Write-Host "[6/6] 启动应用服务..." -ForegroundColor Yellow
docker-compose up -d app
Write-Host "✓ 应用已启动" -ForegroundColor Green
Write-Host ""

# 等待应用启动
Write-Host "→ 等待应用启动..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# 检查健康状态
Write-Host "→ 检查服务健康状态..." -ForegroundColor Yellow
$healthy = $false
for ($i = 1; $i -le 10; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            Write-Host "✓ 服务健康检查通过" -ForegroundColor Green
            $healthy = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 2
    }
}

if (-not $healthy) {
    Write-Host "✗ 服务启动失败，请检查日志：" -ForegroundColor Red
    Write-Host "   docker-compose logs -f app"
    exit 1
}

Write-Host ""
Write-Host "======================================" -ForegroundColor Green
Write-Host "   🎉 部署成功！" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green
Write-Host ""
Write-Host "访问地址：" -ForegroundColor Blue
Write-Host "  主应用:    http://localhost:3000" -ForegroundColor Green
Write-Host "  管理面板:  http://localhost:3000/admin" -ForegroundColor Green
Write-Host "  API健康:   http://localhost:3000/api/health" -ForegroundColor Green
Write-Host ""

$adminEmail = (Get-Content .env | Select-String "ADMIN_EMAIL=" | ForEach-Object { $_ -replace "ADMIN_EMAIL=", "" })
$adminPassword = (Get-Content .env | Select-String "ADMIN_PASSWORD=" | ForEach-Object { $_ -replace "ADMIN_PASSWORD=", "" })

Write-Host "管理员账户：" -ForegroundColor Blue
Write-Host "  邮箱: $adminEmail"
Write-Host "  密码: $adminPassword"
Write-Host ""
Write-Host "常用命令：" -ForegroundColor Blue
Write-Host "  查看日志:   docker-compose logs -f app"
Write-Host "  停止服务:   docker-compose down"
Write-Host "  重启服务:   docker-compose restart"
Write-Host ""
Write-Host "⚠️  首次登录后请立即修改管理员密码！" -ForegroundColor Yellow
Write-Host ""
