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
      storySort: { order: ["Existing website", ["Current pages", "Design language", "Artist header", "Release header", "Current artist"], "Library", ["Patterns", "Actions", "Fields", "Layers"], "Navigation", "Artists", "Forms"] },
    },
    docs: {
      description: {
        component:
          "Uses Label Suite's actual components and shared styles. Public stories use neutral fixtures; any current-site snapshots stay local and excluded from Git. No production data connection or credentials are loaded.",
      },
    },
  },
};

export default preview;
