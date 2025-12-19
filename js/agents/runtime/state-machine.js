/**
 * 状态机工具函数
 */

/**
 * 创建状态转换验证器
 * @param {Object} transitions - 转换表 { [fromState]: [toState1, toState2, ...] }
 * @returns {Function} (from, to, context?) => boolean
 */
export function createTransitionValidator(transitions) {
  return (from, to, context = {}) => {
    const allowed = transitions[from] || [];
    if (!allowed.includes(to)) {
      console.error(`[StateMachine] 非法转换: ${from} → ${to}`, context);
      return false;
    }
    return true;
  };
}

/**
 * 创建带日志的状态转换函数
 * @param {Object} transitions - 转换表
 * @param {string} name - 状态机名称（用于日志）
 */
export function createStateMachine(transitions, name = "StateMachine") {
  const validate = createTransitionValidator(transitions);

  return {
    canTransition: (from, to) => (transitions[from] || []).includes(to),
    transition: (entity, to, context = {}) => {
      const from = entity.status || entity.state;
      if (!validate(from, to, context)) return false;

      console.log(`[${name}] ${from} → ${to}`, context);
      if ("status" in entity) entity.status = to;
      else if ("state" in entity) entity.state = to;
      return true;
    },
    getAllStates: () => Object.keys(transitions),
    getTransitions: (from) => transitions[from] || [],
  };
}
