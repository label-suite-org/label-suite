import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider } from "./ui/sidebar";
import { TooltipProvider } from "./ui/tooltip";

const meta = {
  title: "Navigation/Sidebar",
  component: AppSidebar,
  args: { orgName: "Example Label", dark: false, onToggleTheme: () => {} },
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <SidebarProvider style={{ "--sidebar-width": "12.5rem" } as CSSProperties}><TooltipProvider><Story /><main className="flex-1 p-6 text-sm text-muted-foreground">Browse the workspace. Secondary destinations stay available through their groups and search.</main></TooltipProvider></SidebarProvider>],
} satisfies Meta<typeof AppSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Expanded: Story = {};
