import { motion } from "framer-motion";

interface WindowControlsProps {
  onSettings?: () => void;
}

export function WindowControls({ onSettings }: WindowControlsProps) {
  const handleMinimize = () => window.electronAPI?.minimizeWindow();
  const handleMaximize = () => window.electronAPI?.maximizeWindow();
  const handleClose = () => window.electronAPI?.closeWindow();

  return (
    <div className="flex items-center gap-2 absolute top-4 right-4 z-50">
      <motion.button
        className="w-3 h-3 rounded-full bg-status-warning/80 hover:bg-status-warning"
        onClick={handleMinimize}
        whileHover={{ scale: 1.2 }}
        whileTap={{ scale: 0.9 }}
        title="Minimize"
      />
      <motion.button
        className="w-3 h-3 rounded-full bg-neon-cyan/80 hover:bg-neon-cyan"
        onClick={handleMaximize}
        whileHover={{ scale: 1.2 }}
        whileTap={{ scale: 0.9 }}
        title="Maximize"
      />
      <motion.button
        className="w-3 h-3 rounded-full bg-status-error/80 hover:bg-status-error"
        onClick={handleClose}
        whileHover={{ scale: 1.2 }}
        whileTap={{ scale: 0.9 }}
        title="Close"
      />
      {onSettings && (
        <motion.button
          className="ml-2 w-3 h-3 rounded-full bg-text-secondary/80 hover:bg-neon-cyan"
          onClick={onSettings}
          whileHover={{ scale: 1.2 }}
          whileTap={{ scale: 0.9 }}
          title="Settings"
        />
      )}
    </div>
  );
}
