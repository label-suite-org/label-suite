import type { Preview } from "@storybook/react-vite";
import "../src/styles/global.css";
import { createElement, Fragment } from "react";
import { DevFeedback } from "../src/components/DevFeedback";

const preview: Preview = {
  tags: ["autodocs"],
  decorators: [(Story) => createElement(Fragment, null, createElement(Story), createElement(DevFeedback))],
  parameters: {
    layout: "padded",
    controls: { expanded: true },
    options: {
      storySort: { order: ["Library", "Navigation", "Artists", "Forms"] },
    },
    docs: {
      description: {
        component:
          "Uses Label Suite's installed shadcn components and shared styles. Story records are fictional; no production connection or credentials are loaded.",
      },
    },
  },
};

export default preview;
