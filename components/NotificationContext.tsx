import React, { createContext, useContext, useState, useCallback } from 'react';
import { InlineNotification, NotificationType, ConfirmDialog, PromptDialog } from './InlineNotification';
import { useLanguage } from './LanguageContext';

interface Notification {
  id: string;
  type: NotificationType;
  message: string;
}

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}

interface PromptOptions {
  title?: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
}

interface NotificationContextType {
  notify: (type: NotificationType, message: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within NotificationProvider');
  }
  return context;
};

interface NotificationProviderProps {
  children: React.ReactNode;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
  const { t } = useLanguage();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);
  const [promptState, setPromptState] = useState<{
    isOpen: boolean;
    options: PromptOptions;
    resolve: (value: string | null) => void;
  } | null>(null);

  const notify = useCallback((type: NotificationType, message: string) => {
    const id = Math.random().toString(36).substring(7);
    setNotifications((prev) => [...prev, { id, type, message }]);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({ isOpen: true, options, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (confirmState) {
      confirmState.resolve(true);
      setConfirmState(null);
    }
  }, [confirmState]);

  const handleConfirmCancel = useCallback(() => {
    if (confirmState) {
      confirmState.resolve(false);
      setConfirmState(null);
    }
  }, [confirmState]);

  const prompt = useCallback((options: PromptOptions): Promise<string | null> => {
    return new Promise((resolve) => {
      setPromptState({ isOpen: true, options, resolve });
    });
  }, []);

  const handlePromptConfirm = useCallback(
    (value: string) => {
      if (promptState) {
        promptState.resolve(value);
        setPromptState(null);
      }
    },
    [promptState]
  );

  const handlePromptCancel = useCallback(() => {
    if (promptState) {
      promptState.resolve(null);
      setPromptState(null);
    }
  }, [promptState]);

  return (
    <NotificationContext.Provider value={{ notify, confirm, prompt }}>
      {children}
      
      {/* Global notification container */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-md">
        {notifications.map((notification) => (
          <InlineNotification
            key={notification.id}
            type={notification.type}
            message={notification.message}
            onClose={() => removeNotification(notification.id)}
            autoClose
            duration={5000}
          />
        ))}
      </div>

      {/* Confirm dialog */}
      {confirmState && (
        <ConfirmDialog
          isOpen={confirmState.isOpen}
          title={confirmState.options.title || t('confirm.delete.title')}
          message={confirmState.options.message}
          confirmText={confirmState.options.confirmText || t('common.confirm')}
          cancelText={confirmState.options.cancelText || t('common.cancel')}
          type={confirmState.options.type}
          onConfirm={handleConfirm}
          onCancel={handleConfirmCancel}
        />
      )}

      {/* Prompt dialog */}
      {promptState && (
        <PromptDialog
          isOpen={promptState.isOpen}
          title={promptState.options.title || t('common.info')}
          message={promptState.options.message}
          placeholder={promptState.options.placeholder}
          defaultValue={promptState.options.defaultValue}
          confirmText={promptState.options.confirmText || t('common.ok')}
          cancelText={promptState.options.cancelText || t('common.cancel')}
          onConfirm={handlePromptConfirm}
          onCancel={handlePromptCancel}
        />
      )}
    </NotificationContext.Provider>
  );
};
