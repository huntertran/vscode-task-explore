import * as vscode from 'vscode';

/**
 * Load a webview HTML template from media/<name>.html and substitute resource
 * tokens. The template links media/<name>.css and media/<name>.js (the latter
 * compiled from the matching .scss). Tokens:
 *   {{cspSource}} {{nonce}} {{styleUri}} {{scriptUri}}
 */
export async function loadWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  name: string
): Promise<string> {
  const htmlUri = vscode.Uri.joinPath(extensionUri, 'media', `${name}.html`);
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', `${name}.css`)
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', `${name}.js`)
  );
  const nonce = getNonce();

  const bytes = await vscode.workspace.fs.readFile(htmlUri);
  const template = Buffer.from(bytes).toString('utf8');

  return template
    .replace(/{{cspSource}}/g, webview.cspSource)
    .replace(/{{nonce}}/g, nonce)
    .replace(/{{styleUri}}/g, styleUri.toString())
    .replace(/{{scriptUri}}/g, scriptUri.toString());
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
