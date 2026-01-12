# edit-mode (design) - 编辑模式

交互式幻灯片编辑。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口，导出所有 |
| `edit-mode-agent-loop.js` | EditModeAgentLoop |
| `edit-tools.js` | 编辑工具定义 |
| `tool-executor.js` | createEditToolExecutor |
| `history-manager.js` | EditHistoryManager - 撤销/重做 |

## EditModeAgentLoop

```javascript
import { EditModeAgentLoop } from 'js/agents/stages/design/edit-mode';

const editAgent = new EditModeAgentLoop({ eventBus });
await editAgent.run({
  deck: existingDeck,
  instruction: '把第三页的标题改成蓝色',
});
```

## 编辑工具

```javascript
EditModeTools = {
  UPDATE_SLIDE: 'update_slide',
  DELETE_SLIDE: 'delete_slide',
  REORDER_SLIDES: 'reorder_slides',
  UPDATE_STYLE: 'update_style',
  REPLACE_IMAGE: 'replace_image',
};
```

## 历史管理

```javascript
import { EditHistoryManager } from 'js/agents/stages/design/edit-mode';

const history = new EditHistoryManager();
history.push(currentState);

// 撤销
const previous = history.undo();

// 重做
const next = history.redo();
```
