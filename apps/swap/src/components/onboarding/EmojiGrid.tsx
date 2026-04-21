/**
 * EmojiGrid Component
 * Renders a 3x3 emoji grid for wallet verification display
 */

import { Box } from "@mui/material";

interface EmojiGridProps {
  emojis: string;
  size?: "small" | "medium" | "large";
}

export function EmojiGrid({ emojis, size = "medium" }: EmojiGridProps) {
  const emojiArray = [...emojis];
  const rows = [emojiArray.slice(0, 3), emojiArray.slice(3, 6), emojiArray.slice(6, 9)];
  const fontSize = size === "small" ? "0.9rem" : size === "large" ? "1.8rem" : "1.4rem";

  return (
    <Box sx={{ display: "inline-flex", flexDirection: "column", gap: "2px" }}>
      {rows.map((row, i) => (
        <Box key={i} sx={{ display: "flex", gap: "2px" }}>
          {row.map((emoji, j) => (
            <Box
              key={j}
              sx={{
                fontSize,
                width: "1.2em",
                height: "1.2em",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {emoji}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
