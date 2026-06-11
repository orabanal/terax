"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UIMessage } from "ai";
import { ArrowDown01Icon, Download01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-y-hidden", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex flex-col gap-5 p-4", className)}
    {...props}
  />
);

export interface ScrollAnchorProps {
  /** Number of messages — scroll fires when this increases. */
  messageCount: number;
  /** Chat status — scroll fires on transition to "submitted" or "streaming". */
  status?: string;
}

/**
 * Keeps the conversation pinned to the bottom when new messages arrive
 * or when the agent starts streaming. Uses `useLayoutEffect` so the
 * scroll happens synchronously before the browser paints.
 *
 * During streaming, a `requestAnimationFrame` loop keeps the scroll
 * position locked as long as the user hasn't manually scrolled away.
 * The loop stops as soon as the user scrolls up or streaming ends.
 */
export function ScrollAnchor({ messageCount, status }: ScrollAnchorProps) {
  const { scrollToBottom, isAtBottom } = useStickToBottomContext();
  const prevCountRef = useRef(messageCount);
  const wasStreamingRef = useRef(status === "streaming");

  // Scroll when a new message appears (user sent or agent replied).
  useLayoutEffect(() => {
    if (messageCount !== prevCountRef.current) {
      prevCountRef.current = messageCount;
      scrollToBottom();
    }
  }, [messageCount, scrollToBottom]);

  // Scroll when streaming starts.
  useLayoutEffect(() => {
    const streaming = status === "streaming";
    if (streaming && !wasStreamingRef.current) {
      wasStreamingRef.current = true;
      scrollToBottom();
    }
    if (!streaming) {
      wasStreamingRef.current = false;
    }
  }, [status, scrollToBottom]);

  // Keep scrolling during streaming if user is still at the bottom.
  useEffect(() => {
    if (status !== "streaming" || !isAtBottom) return;
    let active = true;
    const tick = () => {
      if (!active) return;
      scrollToBottom();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      active = false;
    };
  }, [status, isAtBottom, scrollToBottom]);

  return null;
}

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <Button
        className={cn(
          "absolute bottom-3 left-1/2 size-7 -translate-x-1/2 rounded-full border-border/50 bg-background/90 shadow-md backdrop-blur dark:bg-background/80 dark:hover:bg-muted",
          className
        )}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <HugeiconsIcon icon={ArrowDown01Icon} size={13} strokeWidth={2} />
      </Button>
    )
  );
};

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

export type ConversationDownloadProps = Omit<
  ComponentProps<typeof Button>,
  "onClick"
> & {
  messages: UIMessage[];
  filename?: string;
  formatMessage?: (message: UIMessage, index: number) => string;
};

const defaultFormatMessage = (message: UIMessage): string => {
  const roleLabel =
    message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${getMessageText(message)}`;
};

export const messagesToMarkdown = (
  messages: UIMessage[],
  formatMessage: (
    message: UIMessage,
    index: number
  ) => string = defaultFormatMessage
): string => messages.map((msg, i) => formatMessage(msg, i)).join("\n\n");

export const ConversationDownload = ({
  messages,
  filename = "conversation.md",
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn(
        "absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted",
        className
      )}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <HugeiconsIcon icon={Download01Icon} size={16} />}
    </Button>
  );
};
