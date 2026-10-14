import React from 'react';
import { m, AnimatePresence } from 'framer-motion';
import { Terminal, Zap, X } from 'lucide-react';

interface PendingNotesPanelProps {
  pendingNotes: string[];
  onRemoveNote: (index: number) => void;
}

const PendingNotesPanelView: React.FC<PendingNotesPanelProps> = ({
  pendingNotes,
  onRemoveNote,
}) => {
  return (
    <div className="glass-card-premium h-full w-full p-4 lg:p-[1.5vw] rounded-3xl flex flex-col shadow-lg relative group overflow-hidden">
      <div className="flex items-center justify-between mb-3 lg:mb-[2vh]">
        <h3 className="text-xs lg:text-[clamp(0.65rem,0.7vw,0.8rem)] font-black text-gray-500 dark:text-stellar-label uppercase tracking-[0.2em] flex items-center gap-2">
          <Terminal className="w-4 h-4 text-orange-500" />
          待定筆記 ({pendingNotes.length})
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-1 relative z-10 min-h-25">
        <AnimatePresence mode="popLayout">
          {pendingNotes.length === 0 ? (
            <m.div
              key="empty-notes"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center text-center space-y-4 min-h-25"
            >
              <div className="w-10 h-10 lg:w-[8vh] lg:h-[8vh] max-w-16 max-h-16 rounded-full border-2 border-dashed border-current flex items-center justify-center opacity-50">
                <Zap className="w-1/2 h-1/2" />
              </div>
              <p className="text-[0.6rem] lg:text-[0.65rem] uppercase tracking-widest text-center font-bold">
                請在中欄輸入
                <br />
                並按 Enter
              </p>
            </m.div>
          ) : (
            pendingNotes.map((note, idx) => (
              <m.div
                key={`${idx}-${note.substring(0, 10)}`}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                layout
                className="group/item relative p-3 bg-white/60 dark:bg-white/10 rounded-xl border border-white/20 dark:border-white/5 hover:border-orange-500/30 transition-colors cursor-default shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-gray-700 dark:text-gray-200 break-all font-mono leading-relaxed">
                    {note}
                  </p>
                  {/* Make close button always visible on mobile/touch, hover only on desktop */}
                  <button
                    onClick={() => onRemoveNote(idx)}
                    className="text-gray-400 hover:text-red-500 transition-colors opacity-100 lg:opacity-0 lg:group-hover/item:opacity-100 shrink-0 p-1"
                  >
                    <X className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                  </button>
                </div>
              </m.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Decorative BG element */}
      <div className="absolute -bottom-20 -left-20 w-40 h-40 lg:w-56 lg:h-56 fx-glow text-orange-500/10" />
    </div>
  );
};

/** Memoized: the landing page re-renders on every keystroke in the note input. */
export const PendingNotesPanel = React.memo(PendingNotesPanelView);
