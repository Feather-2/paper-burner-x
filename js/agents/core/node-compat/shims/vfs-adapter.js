/**
 * VirtualFS Adapter shim - Simplified version
 * Provides basic VFS adapter interface for compatibility
 */

export class VirtualFSAdapter {
  constructor(_vfs) {
    this.vfs = _vfs;
  }

  async readFile(_path, _options) {
    throw new Error('VirtualFSAdapter.readFile not implemented in browser');
  }

  async readFileBuffer(_path) {
    throw new Error('VirtualFSAdapter.readFileBuffer not implemented in browser');
  }

  async writeFile(_path, _content, _options) {
    throw new Error('VirtualFSAdapter.writeFile not implemented in browser');
  }

  async appendFile(_path, _content, _options) {
    throw new Error('VirtualFSAdapter.appendFile not implemented in browser');
  }

  async mkdir(_path, _options) {
    throw new Error('VirtualFSAdapter.mkdir not implemented in browser');
  }

  async readdir(_path, _options) {
    throw new Error('VirtualFSAdapter.readdir not implemented in browser');
  }

  async stat(_path) {
    throw new Error('VirtualFSAdapter.stat not implemented in browser');
  }

  async unlink(_path) {
    throw new Error('VirtualFSAdapter.unlink not implemented in browser');
  }

  async rmdir(_path, _options) {
    throw new Error('VirtualFSAdapter.rmdir not implemented in browser');
  }

  async rename(_oldPath, _newPath) {
    throw new Error('VirtualFSAdapter.rename not implemented in browser');
  }

  async copyFile(_src, _dest) {
    throw new Error('VirtualFSAdapter.copyFile not implemented in browser');
  }
}

export default VirtualFSAdapter;
