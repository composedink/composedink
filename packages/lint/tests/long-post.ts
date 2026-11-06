export const paragraph =
  "The garden grows beside the house where we read and write about the world each morning before the sun warms the quiet path near home.";
export const longPost = Array.from({ length: 200 }, (_, i) =>
  paragraph.replace("garden", i % 2 ? "garden" : "flower").replace("home.", `home${i}.`),
).join("\n\n");
