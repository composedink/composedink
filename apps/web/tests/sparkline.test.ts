import { expect, it } from "vite-plus/test";
import { bucketSentences, byLength, MAX_BARS } from "../src/SentenceSparkline.tsx";
const lengths = (...words: number[]) => words.map((w) => ({ words: w }));
it("draws nothing for empty prose and one bar per sentence up to 120", () => {
  expect(MAX_BARS).toBe(120);
  expect(bucketSentences([])).toEqual([]);
  expect(bucketSentences(lengths(7, 3))).toEqual([
    { members: [0], height: 7, representative: 0 },
    { members: [1], height: 3, representative: 1 },
  ]);
  const exactly = bucketSentences(lengths(...Array.from({ length: 120 }, (_, i) => i + 1)));
  expect(exactly).toHaveLength(120);
  expect(exactly[119]).toEqual({ members: [119], height: 120, representative: 119 });
});
it("buckets 121 sentences into 120 bars with only the last holding two", () => {
  // floor(i·121/120) = i for i < 120, and floor(120·121/120) = 121.
  const words = Array.from({ length: 121 }, () => 4);
  words[119] = 2;
  words[120] = 9;
  const bars = bucketSentences(lengths(...words));
  expect(bars).toHaveLength(120);
  expect(bars.slice(0, 119).every((b, i) => b.members.length === 1 && b.members[0] === i)).toBe(
    true,
  );
  expect(bars[119]).toEqual({ members: [119, 120], height: 5.5, representative: 120 });
});
it("buckets 240 sentences in pairs and keeps every sentence exactly once", () => {
  const words = Array.from({ length: 240 }, (_, i) => (i % 2 ? 10 : 20));
  const bars = bucketSentences(lengths(...words));
  expect(bars).toHaveLength(120);
  expect(bars[0]).toEqual({ members: [0, 1], height: 15, representative: 0 });
  expect(bars[37]).toEqual({ members: [74, 75], height: 15, representative: 74 });
  expect(bars.flatMap((b) => b.members)).toEqual(Array.from({ length: 240 }, (_, i) => i));
});
it("uses contiguous floor boundaries, mean heights and the first longest member", () => {
  // N = 7, max = 3: boundaries 0, floor(7/3) = 2, floor(14/3) = 4, 7.
  expect(bucketSentences(lengths(1, 5, 5, 2, 3, 3, 1), 3)).toEqual([
    { members: [0, 1], height: 3, representative: 1 },
    { members: [2, 3], height: 3.5, representative: 2 },
    { members: [4, 5, 6], height: 7 / 3, representative: 4 },
  ]);
  // N = 250: bucket 1 is [floor(250/120), floor(500/120)) = [2, 4); bucket 2 is [4, 6).
  const bars = bucketSentences(lengths(...Array.from({ length: 250 }, (_, i) => i)));
  expect(bars[1].members).toEqual([2, 3]);
  expect(bars[2].members).toEqual([4, 5]);
  expect(bars[23].members).toEqual([47, 48, 49]);
  expect(bars[23].height).toBe(48);
});
it("lists sentences longest first with source order on ties", () => {
  expect(byLength(lengths(3, 9, 3, 12, 9))).toEqual([3, 1, 4, 0, 2]);
  expect(byLength([])).toEqual([]);
});
