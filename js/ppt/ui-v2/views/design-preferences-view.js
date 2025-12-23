/**
 * Design preferences view (defaults to design spec tab)
 */

import PageLayoutView from './page-layout-view.js';

export class DesignPreferencesView extends PageLayoutView {
  constructor(options = {}) {
    super(options);
    this._pageLayoutTab = 2;
  }
}

export default DesignPreferencesView;
