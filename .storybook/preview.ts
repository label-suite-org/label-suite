import type { Preview } from "@storybook/react-vite";
import "../src/styles/global.css";

const preview: Preview = {
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    controls: { expanded: true },
    docs: {
      description: {
        component: "Uses Label Suite's installed shadcn components and shared styles. Story records are fictional; no production connection or credentials are loaded.",
      },
    },
  },
};

export default preview;
