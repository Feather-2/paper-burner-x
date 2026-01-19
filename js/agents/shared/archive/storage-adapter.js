/**
 * 存储适配器接口
 * @typedef {Object} StorageAdapter
 * @property {(key: string) => Promise<any|null>} get - 获取值
 * @property {(key: string, value: any) => Promise<boolean>} set - 设置值
 * @property {(key: string) => Promise<boolean>} delete - 删除值
 * @property {(pattern?: string) => Promise<string[]>} keys - 列出键
 */

export {};
