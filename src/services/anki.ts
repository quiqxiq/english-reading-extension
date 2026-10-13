export interface AnkiNotePayload {
  word: string;
  sentence: string;
  translation: string;
  definition: string;
  nuance?: string;
  audioUrl?: string;
  deckName?: string;
  allowDuplicate?: boolean;
}

export class AnkiService {
  private static endpoint = 'http://127.0.0.1:8765';
  private static defaultDeck = 'English Immersion';
  private static modelName = 'English Immersion Model';

  private static async invoke(action: string, params: Record<string, unknown> = {}): Promise<any> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, version: 6, params }),
    });
    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}: Unable to connect to AnkiConnect`);
    }
    const data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data.result;
  }

  static async isConnected(): Promise<boolean> {
    try {
      const ver = await this.invoke('version');
      return typeof ver === 'number';
    } catch {
      return false;
    }
  }

  static async ensureDeck(deckName = this.defaultDeck): Promise<void> {
    try {
      await this.invoke('createDeck', { deck: deckName });
    } catch (err) {
      // If deck already exists, ignore
      console.warn('ensureDeck:', err);
    }
  }

  static async ensureModel(): Promise<string> {
    try {
      const models: string[] = await this.invoke('modelNames');
      if (models.includes(this.modelName)) {
        return this.modelName;
      }

      await this.invoke('createModel', {
        modelName: this.modelName,
        inOrderFields: ['Word', 'Sentence', 'Translation', 'Definition', 'Nuance', 'Audio'],
        css: `
          .card {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 18px;
            text-align: center;
            color: #1f2937;
            background-color: #ffffff;
            padding: 24px;
          }
          .word {
            font-size: 32px;
            font-weight: bold;
            color: #2563eb;
            margin-bottom: 8px;
          }
          .sentence {
            font-size: 18px;
            font-style: italic;
            color: #4b5563;
            margin: 16px 0;
            line-height: 1.5;
          }
          .meaning-box {
            text-align: left;
            margin-top: 16px;
            border-top: 2px solid #e5e7eb;
            padding-top: 16px;
            font-size: 16px;
          }
          .definition {
            white-space: pre-wrap;
            margin-top: 6px;
            line-height: 1.6;
            color: #374151;
          }
          .label {
            font-weight: 600;
            color: #4b5563;
          }
          .nuance-box {
            background: #f5f3ff;
            border-left: 4px solid #8b5cf6;
            padding: 10px 14px;
            margin: 12px 0;
            border-radius: 4px;
            color: #4c1d95;
            white-space: pre-wrap;
          }
        `,
        cardTemplates: [
          {
            Name: 'Recognition',
            Front: `
              <div class="word">{{Word}}</div>
              <div class="sentence">"{{Sentence}}"</div>
            `,
            Back: `
              <div class="word">{{Word}}</div>
              <div class="sentence">"{{Sentence}}"</div>
              <div class="meaning-box">
                <div><span class="label">Translation:</span> {{Translation}}</div>
                <div style="margin-top: 10px;"><span class="label">Definition:</span></div>
                <div class="definition">{{Definition}}</div>
                {{#Nuance}}
                <div class="nuance-box">
                  <div style="font-weight: 600; margin-bottom: 4px;">AI Nuance & Context:</div>
                  {{Nuance}}
                </div>
                {{/Nuance}}
                {{#Audio}}<div style="margin-top: 12px;">{{Audio}}</div>{{/Audio}}
              </div>
            `,
          },
        ],
      });
      return this.modelName;
    } catch {
      // Fallback to Basic model if custom model creation fails
      return 'Basic';
    }
  }

  static async addVocabulary(payload: AnkiNotePayload): Promise<{ success: boolean; noteId?: number; isDuplicate?: boolean; error?: string }> {
    try {
      const deck = payload.deckName || this.defaultDeck;
      await this.ensureDeck(deck);
      const model = await this.ensureModel();

      let fields: Record<string, string>;
      if (model === this.modelName) {
        fields = {
          Word: payload.word,
          Sentence: payload.sentence,
          Translation: payload.translation || '',
          Definition: payload.definition || '',
          Nuance: payload.nuance || '',
          Audio: '',
        };
      } else {
        // Fallback Basic format
        const front = `<b>${payload.word}</b><br><br><i>"${payload.sentence}"</i>`;
        let back = `<b>Translation:</b> ${payload.translation || '-'}<br><br><b>Definition:</b> ${payload.definition || '-'}`;
        if (payload.nuance) {
          back += `<br><br><b>AI Nuance:</b><br>${payload.nuance}`;
        }
        fields = { Front: front, Back: back };
      }

      const allowDup = payload.allowDuplicate !== undefined ? payload.allowDuplicate : true;

      const noteParams: Record<string, unknown> = {
        deckName: deck,
        modelName: model,
        fields,
        tags: ['english-immersion', 'reading-mode'],
        options: {
          allowDuplicate: allowDup,
          duplicateScope: 'deck',
        },
      };

      if (payload.audioUrl && model === this.modelName) {
        try {
          const audioRes = await fetch(payload.audioUrl);
          if (audioRes.ok) {
            const buffer = await audioRes.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64Data = btoa(binary);
            (noteParams as any).audio = [
              {
                data: base64Data,
                filename: `eir_${payload.word}_${Date.now()}.mp3`,
                fields: ['Audio'],
              },
            ];
          }
        } catch (audioErr) {
          console.warn('Failed to download audio for Anki:', audioErr);
        }
      }

      const noteId = await this.invoke('addNote', { note: noteParams });
      return { success: true, noteId };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.toLowerCase().includes('duplicate')) {
        return {
          success: true,
          isDuplicate: true,
          error: 'This card already exists in your Anki collection.',
        };
      }
      return {
        success: false,
        error: errMsg,
      };
    }
  }

  static async findNotesForWord(word: string, deckName = this.defaultDeck): Promise<number[]> {
    try {
      const cleanWord = word.trim().toLowerCase();
      const query = `deck:"${deckName}" ("Word:${cleanWord}" or "Front:*${cleanWord}*")`;
      let noteIds: number[] = await this.invoke('findNotes', { query });
      if (!noteIds || noteIds.length === 0) {
        noteIds = await this.invoke('findNotes', { query: `"Word:${cleanWord}"` });
      }
      return noteIds || [];
    } catch {
      return [];
    }
  }

  static async getNoteInfo(noteId: number): Promise<any | null> {
    try {
      const notes: any[] = await this.invoke('notesInfo', { notes: [noteId] });
      return notes && notes.length > 0 ? notes[0] : null;
    } catch {
      return null;
    }
  }

  static async updateNoteFields(noteId: number, fields: Record<string, string>): Promise<boolean> {
    try {
      await this.invoke('updateNoteFields', {
        note: {
          id: noteId,
          fields,
        },
      });
      return true;
    } catch (err) {
      console.warn('updateNoteFields error:', err);
      return false;
    }
  }

  static async addOrAppendVocabulary(payload: AnkiNotePayload): Promise<{
    success: boolean;
    action: 'created' | 'appended' | 'updated';
    noteId?: number;
    error?: string;
  }> {
    try {
      const deck = payload.deckName || this.defaultDeck;
      await this.ensureDeck(deck);
      await this.ensureModel();

      const existingNotes = await this.findNotesForWord(payload.word, deck);
      if (existingNotes.length > 0) {
        const noteId = existingNotes[0];
        const noteInfo = await this.getNoteInfo(noteId);

        if (noteInfo && noteInfo.fields) {
          const currentFields = noteInfo.fields;
          const fieldsToUpdate: Record<string, string> = {};

          if (currentFields.Definition !== undefined) {
            const currentDef = currentFields.Definition.value || '';
            const newExplanation = payload.definition || payload.nuance || '';
            if (newExplanation && !currentDef.includes(newExplanation.slice(0, 40))) {
              const separator = currentDef ? '\n\n<hr style="border:none;border-top:1px dashed #cbd5e1;margin:12px 0;">\n\n' : '';
              fieldsToUpdate.Definition = `${currentDef}${separator}<b>[Additional Context & Explanation]:</b>\n${newExplanation}`;
            } else if (!currentDef && newExplanation) {
              fieldsToUpdate.Definition = newExplanation;
            }
          }

          if (currentFields.Translation !== undefined) {
            const currentTrans = currentFields.Translation.value || '';
            if (!currentTrans && payload.translation) {
              fieldsToUpdate.Translation = payload.translation;
            }
          }

          if (currentFields.Sentence !== undefined) {
            const currentSent = currentFields.Sentence.value || '';
            if (!currentSent && payload.sentence) {
              fieldsToUpdate.Sentence = payload.sentence;
            } else if (payload.sentence && !currentSent.includes(payload.sentence)) {
              fieldsToUpdate.Sentence = `${currentSent}<br><br><i>"${payload.sentence}"</i>`;
            }
          }

          if (currentFields.Nuance !== undefined && payload.nuance) {
            const curNuance = currentFields.Nuance.value || '';
            if (!curNuance.includes(payload.nuance.slice(0, 30))) {
              fieldsToUpdate.Nuance = curNuance ? `${curNuance}\n\n---\n${payload.nuance}` : payload.nuance;
            }
          }

          if (currentFields.Back !== undefined) {
            const curBack = currentFields.Back.value || '';
            const addExp = payload.definition || payload.nuance || '';
            fieldsToUpdate.Back = `${curBack}<br><br><hr><br><b>Additional Explanation:</b><br>${addExp}`;
          }

          if (Object.keys(fieldsToUpdate).length > 0) {
            const updated = await this.updateNoteFields(noteId, fieldsToUpdate);
            if (updated) {
              return { success: true, action: 'appended', noteId };
            }
          } else {
            return { success: true, action: 'appended', noteId };
          }
        }
      }

      const addRes = await this.addVocabulary(payload);
      return {
        success: addRes.success,
        action: 'created',
        noteId: addRes.noteId,
        error: addRes.error,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { success: false, action: 'created', error: errMsg };
    }
  }
}
