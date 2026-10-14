import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { m, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';

export interface DropdownItem {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: 'default' | 'danger';
  hidden?: boolean;
}

/** Viewport position of the trigger, used to place the menu. */
interface MenuCoords {
  /** Trigger bottom edge (menu top when opening downwards). */
  top: number;
  /** Trigger top edge (menu bottom when opening upwards). */
  bottom: number;
  /** Trigger left edge. */
  left: number;
  /** Trigger width. */
  width: number;
  /** Open above the trigger (trigger in the lower half of the viewport). */
  openUp: boolean;
}

interface DropdownMenuProps {
  trigger: React.ReactNode;
  items: DropdownItem[];
  className?: string;
  align?: 'left' | 'right';
}

export const DropdownMenu: React.FC<DropdownMenuProps> = ({ 
  trigger, 
  items, 
  className,
  align = 'right'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<MenuCoords>({ top: 0, bottom: 0, left: 0, width: 0, openUp: false });

  const updateCoords = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom,
        bottom: rect.top,
        left: rect.left,
        width: rect.width,
        // Triggers in the lower half open the menu upwards: opening down from
        // a card near the bottom of a phone screen put the last items
        // (e.g. 刪除) off-screen, where they could not be tapped.
        openUp: rect.top + rect.height / 2 > window.innerHeight / 2,
      });
    }
  };

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateCoords();
    setIsOpen(!isOpen);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isOpen && triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    
    const handleScrollOrResize = () => {
      if (isOpen) {
        updateCoords();
      }
    };

    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
      window.addEventListener('scroll', handleScrollOrResize, true);
      window.addEventListener('resize', handleScrollOrResize);
    }
    return () => {
      document.removeEventListener('click', handleClickOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  const visibleItems = items.filter(item => !item.hidden);

  const menuContent = (
    <AnimatePresence>
      {isOpen && (
        <m.div
          initial={{ opacity: 0, scale: 0.95, y: coords.openUp ? 10 : -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: coords.openUp ? 10 : -10 }}
          style={{
            position: 'fixed',
            ...(coords.openUp
              ? { bottom: window.innerHeight - coords.bottom + 8 }
              : { top: coords.top + 8 }
            ),
            ...(align === 'right' 
              ? { right: window.innerWidth - (coords.left + coords.width) } 
              : { left: coords.left }
            ),
            zIndex: 9999,
          }}
          className={cn(
            "min-w-40 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 p-1.5 focus:outline-none",
            className
          )}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col gap-0.5">
            {visibleItems.map((item, index) => (
              <React.Fragment key={index}>
                {item.label === 'separator' ? (
                  <div className="h-px bg-gray-100 dark:bg-white/5 my-1" />
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      item.onClick();
                      setIsOpen(false);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseUp={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                    className={cn(
                      "flex items-center gap-3 w-full px-3 py-3 lg:py-2.5 rounded-xl transition-all text-left",
                      item.variant === 'danger' 
                        ? "text-red-500 hover:bg-red-500/10" 
                        : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10"
                    )}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    <span className="text-sm font-bold">{item.label}</span>
                  </button>
                )}
              </React.Fragment>
            ))}
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className="inline-block" ref={triggerRef}>
      <div onClick={toggleMenu} className="cursor-pointer">
        {trigger}
      </div>
      {createPortal(menuContent, document.body)}
    </div>
  );
};
