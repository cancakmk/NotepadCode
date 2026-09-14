import * as vscode from 'vscode';
import { NotebookService } from '../services/NotebookService';
import { ExportImportService } from '../services/ExportImportService';

/**
 * Registers the @notepad chat participant in VS Code Copilot.
 * Allows interactive natural-language conversations with notes and slash commands like /list and /search.
 */
export function registerNotepadChatParticipant(
  context: vscode.ExtensionContext,
  notebookService: NotebookService,
  _exportImportService: ExportImportService,
  onDataChanged: () => void
): vscode.Disposable {
  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    _chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ) => {
    const prompt = request.prompt.trim();

    // Slash command: /list
    if (request.command === 'list') {
      const notebooks = await notebookService.getAllNotebooks();
      if (notebooks.length === 0) {
        stream.markdown('No notebooks found yet. You can create a new notebook by asking `@notepad create a notebook named My Notes`.\n');
        return;
      }

      stream.markdown('### 📓 Your Notebooks\n\n');
      for (const nb of notebooks) {
        const pages = nb.getPages();
        stream.markdown(`- **${nb.title}** *(${pages.length} ${pages.length === 1 ? 'page' : 'pages'})*\n`);
        for (const p of pages) {
          stream.markdown(`  - 📄 ${p.title} *(ID: \`${p.id}\`)*\n`);
        }
      }
      return;
    }

    // Slash command: /search
    if (request.command === 'search') {
      if (!prompt) {
        stream.markdown('Please enter a keyword to search for. Example: `@notepad /search react`\n');
        return;
      }

      const results = await notebookService.search(prompt);
      if (results.length === 0) {
        stream.markdown(`No notes found matching **"${prompt}"**.\n`);
        return;
      }

      stream.markdown(`### 🔍 Search Results: "${prompt}" (${results.length} ${results.length === 1 ? 'match' : 'matches'})\n\n`);
      for (const r of results) {
        stream.markdown(`- **${r.notebookTitle}** ➔ **${r.pageTitle}**\n  > ${r.matchedSnippet}\n\n`);
      }
      return;
    }

    // General Chat Request with Copilot Language Model
    try {
      // Find available chat model
      const [model] = await vscode.lm.selectChatModels({
        vendor: 'copilot',
        family: 'gpt-4o',
      });

      const activeModel = model || (await vscode.lm.selectChatModels())[0];

      if (!activeModel) {
        stream.markdown('VS Code Copilot model not found. Please ensure GitHub Copilot is enabled and active.\n');
        return;
      }

      const allNotebooks = await notebookService.getAllNotebooks();
      const summaryContext = allNotebooks.map((nb) => ({
        id: nb.id,
        title: nb.title,
        pages: nb.getPages().map((p) => ({ id: p.id, title: p.title, snippet: p.content.slice(0, 100) })),
      }));

      const systemPrompt = `You are the official assistant for Notepad Code, a minimalist note-taking extension in VS Code.
You can read, search, organize, create, and manage the user's notebooks and pages.
When answering, be helpful, concise, and format notes with markdown.
Current Notebooks Context:
${JSON.stringify(summaryContext, null, 2)}`;

      const messages = [
        vscode.LanguageModelChatMessage.User(systemPrompt),
        vscode.LanguageModelChatMessage.User(prompt),
      ];

      const chatResponse = await activeModel.sendRequest(messages, {}, token);

      for await (const fragment of chatResponse.text) {
        stream.markdown(fragment);
      }
    } catch (err: any) {
      stream.markdown(`An error occurred: ${err.message}\n`);
    }
  };

  const participant = vscode.chat.createChatParticipant('notepad-code.participant', handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'notepad-icon.svg');
  return participant;
}
