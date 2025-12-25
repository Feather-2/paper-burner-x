<!-- 在现有的标签页导航后添加新标签页 -->

<!-- 在第 81-93 行之间插入以下按钮 -->
<button onclick="switchTab('overview')" id="tab-overview"
    class="tab-button px-6 py-3 border-b-2 border-transparent font-medium text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap">
    概览
</button>

<!-- 在用户管理按钮后添加 -->
<button onclick="switchTab('quotas')" id="tab-quotas"
    class="tab-button px-6 py-3 border-b-2 border-transparent font-medium text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap">
    配额管理
</button>

<button onclick="switchTab('activity')" id="tab-activity"
    class="tab-button px-6 py-3 border-b-2 border-transparent font-medium text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap">
    活动日志
</button>


<!-- ======================== 概览标签页内容 ======================== -->
<!-- 在现有标签页内容区域添加 -->

<div id="content-overview" class="p-6 hidden">
    <!-- 使用趋势图表 -->
    <div class="mb-8">
        <h3 class="text-lg font-medium mb-4">使用趋势（最近30天）</h3>
        <div class="bg-white p-4 rounded-lg border">
            <canvas id="trendChart" height="80"></canvas>
        </div>
    </div>

    <!-- 文档状态统计 -->
    <div class="mb-8">
        <h3 class="text-lg font-medium mb-4">文档状态分布</h3>
        <div id="documentsByStatus" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <!-- 动态加载 -->
        </div>
    </div>

    <!-- 最活跃用户 -->
    <div>
        <h3 class="text-lg font-medium mb-4">Top 10 活跃用户（本月）</h3>
        <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">排名</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">用户</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">邮箱</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">文档数</th>
                    </tr>
                </thead>
                <tbody id="topUsersList" class="bg-white divide-y divide-gray-200">
                    <!-- 动态加载 -->
                </tbody>
            </table>
        </div>
    </div>
</div>


<!-- ======================== 配额管理标签页内容 ======================== -->

<div id="content-quotas" class="p-6 hidden">
    <div class="mb-4">
        <h3 class="text-lg font-medium mb-2">配额管理</h3>
        <p class="text-sm text-gray-600">为用户设置文档数量和存储空间限制（-1 表示无限制）</p>
    </div>

    <!-- 用户选择 -->
    <div class="mb-6">
        <label class="block text-sm font-medium text-gray-700 mb-2">选择用户</label>
        <select id="quotaUserId" onchange="loadUserQuota()"
            class="block w-full px-3 py-2 border border-gray-300 rounded-md">
            <option value="">请选择用户...</option>
        </select>
    </div>

    <!-- 配额设置表单 -->
    <div id="quotaForm" class="hidden space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
                <label class="block text-sm font-medium text-gray-700">每日文档限制</label>
                <input type="number" id="maxDocumentsPerDay"
                    class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
                <p class="mt-1 text-xs text-gray-500">-1 表示无限制</p>
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700">每月文档限制</label>
                <input type="number" id="maxDocumentsPerMonth"
                    class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
                <p class="mt-1 text-xs text-gray-500">-1 表示无限制</p>
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700">存储空间限制（MB）</label>
                <input type="number" id="maxStorageSize"
                    class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
                <p class="mt-1 text-xs text-gray-500">-1 表示无限制</p>
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700">API Keys 数量限制</label>
                <input type="number" id="maxApiKeysCount"
                    class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
                <p class="mt-1 text-xs text-gray-500">-1 表示无限制</p>
            </div>
        </div>

        <!-- 当前使用量 -->
        <div class="bg-gray-50 p-4 rounded-lg">
            <h4 class="text-sm font-medium text-gray-700 mb-3">当前使用量</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <div class="text-sm text-gray-600">本月文档数</div>
                    <div id="documentsThisMonthQuota" class="text-lg font-semibold">0</div>
                    <div class="w-full bg-gray-200 rounded-full h-2 mt-2">
                        <div id="documentsProgressBar" class="bg-blue-600 h-2 rounded-full transition-all" style="width: 0%"></div>
                    </div>
                </div>
                <div>
                    <div class="text-sm text-gray-600">存储使用（MB）</div>
                    <div id="currentStorageUsed" class="text-lg font-semibold">0</div>
                    <div class="w-full bg-gray-200 rounded-full h-2 mt-2">
                        <div id="storageProgressBar" class="bg-green-600 h-2 rounded-full transition-all" style="width: 0%"></div>
                    </div>
                </div>
            </div>
        </div>

        <div class="flex space-x-4">
            <button onclick="saveUserQuota()"
                class="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700">
                保存配额
            </button>
            <button onclick="resetUserQuota()"
                class="bg-gray-200 px-6 py-2 rounded-md hover:bg-gray-300">
                重置使用量
            </button>
        </div>
    </div>
</div>


<!-- ======================== 活动日志标签页内容 ======================== -->

<div id="content-activity" class="p-6 hidden">
    <div class="mb-6">
        <h3 class="text-lg font-medium mb-2">用户活动日志</h3>
        <div class="flex items-center space-x-4">
            <div class="flex-1">
                <label class="block text-sm font-medium text-gray-700 mb-2">选择用户</label>
                <select id="activityUserId" onchange="loadUserActivity()"
                    class="block w-full px-3 py-2 border border-gray-300 rounded-md">
                    <option value="">请选择用户...</option>
                </select>
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">显示条数</label>
                <select id="activityLimit" onchange="loadUserActivity()"
                    class="block w-full px-3 py-2 border border-gray-300 rounded-md">
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="200">200</option>
                </select>
            </div>
        </div>
    </div>

    <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">时间</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">资源ID</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">详情</th>
                </tr>
            </thead>
            <tbody id="activityLogsList" class="bg-white divide-y divide-gray-200">
                <tr>
                    <td colspan="4" class="px-6 py-4 text-center text-gray-500">
                        请选择用户查看活动日志
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</div>


<!-- ======================== 在统计卡片下方添加额外统计 ======================== -->
<!-- 在第 75 行的统计卡片后添加 -->

<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
    <div class="bg-white p-6 rounded-lg shadow">
        <div class="text-gray-500 text-sm mb-2">本周处理</div>
        <div id="documentsThisWeek" class="text-2xl font-bold">-</div>
    </div>
    <div class="bg-white p-6 rounded-lg shadow">
        <div class="text-gray-500 text-sm mb-2">本月处理</div>
        <div id="documentsThisMonth" class="text-2xl font-bold">-</div>
    </div>
    <div class="bg-white p-6 rounded-lg shadow">
        <div class="text-gray-500 text-sm mb-2">总存储使用</div>
        <div id="totalStorageMB" class="text-2xl font-bold">- MB</div>
    </div>
</div>
