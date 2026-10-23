/**
 * Asset manifest. Evaluated by both the runtime and the editor: no side effects.
 * Phengos draws its lights, outlines and stars procedurally at runtime, so the
 * manifest only lists the UIKitML panels.
 */
import { AssetType, defineAssets } from '@iwsdk/core';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

const uikitml = (fileName: string, name: string) => ({
  url: publicAssetUrl(`ui/${fileName}`),
  type: AssetType.UIKitML,
  name,
});

export default defineAssets({
  'hud-panel': uikitml('hud.uikitml', 'HUD'),
  'tabs-panel': uikitml('tabs.uikitml', 'Tabs'),
  'card-panel': uikitml('card.uikitml', 'Card'),
  'menu-panel': uikitml('menu.uikitml', 'Menu'),
});
