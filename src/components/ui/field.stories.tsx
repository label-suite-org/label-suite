import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "./field";
import { Input } from "./input";
import { Textarea } from "./textarea";
import { Select } from "./select";
import { Button } from "./button";
import { Checkbox } from "./checkbox";

const meta = {
  title: "Library/Fields",
  component: Field,
  parameters: {
    docs: {
      description: {
        component:
          "Visible associated labels, descriptions for useful context, errors next to the affected field. Input and Select share height, corners and focus treatment. Provider observations are read-only and show their source.",
      },
    },
  },
} satisfies Meta<typeof Field>;
export default meta;
type Story = StoryObj<typeof meta>;

function ReleaseForm({
  initialTitle = "Low Tide",
  disabled = false,
  showError = false,
}: {
  initialTitle?: string;
  disabled?: boolean;
  showError?: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [format, setFormat] = useState("ep");
  const [submitted, setSubmitted] = useState(showError);
  const [saved, setSaved] = useState(false);
  const invalid = submitted && !title.trim();
  return (
    <form
      className="max-w-xl space-y-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        setSaved(Boolean(title.trim()));
      }}
    >
      <FieldGroup>
        <div className="grid gap-5 sm:grid-cols-[2fr_1fr]">
          <Field data-invalid={invalid} data-disabled={disabled}>
            <FieldLabel htmlFor="library-title">Release title</FieldLabel>
            <Input
              id="library-title"
              value={title}
              disabled={disabled}
              onChange={(event) => {
                setTitle(event.target.value);
                setSaved(false);
              }}
              aria-invalid={invalid}
              aria-describedby={invalid ? "library-title-error" : undefined}
            />
            {invalid && (
              <FieldError id="library-title-error">
                Enter the release title.
              </FieldError>
            )}
          </Field>
          <Field data-disabled={disabled}>
            <FieldLabel htmlFor="library-format">Format</FieldLabel>
            <Select
              id="library-format"
              value={format}
              disabled={disabled}
              className="w-full"
              onValueChange={(value) => {
                setFormat(value ?? "ep");
                setSaved(false);
              }}
              options={[
                { value: "single", label: "Single" },
                { value: "ep", label: "EP" },
                { value: "album", label: "Album" },
              ]}
            />
          </Field>
        </div>
        <Field data-disabled={disabled}>
          <FieldLabel htmlFor="library-notes">Notes</FieldLabel>
          <Textarea
            id="library-notes"
            disabled={disabled}
            defaultValue="Confirm the final master before delivery."
            aria-describedby="library-notes-help"
          />
          <FieldDescription id="library-notes-help">
            Internal notes for the label team.
          </FieldDescription>
        </Field>
        <Field orientation="horizontal" data-disabled={disabled}>
          <Checkbox id="library-explicit" disabled={disabled} />
          <FieldLabel htmlFor="library-explicit">
            Contains explicit lyrics
          </FieldLabel>
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={disabled}>
          Save changes
        </Button>
        <Button
          type="reset"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            setTitle(initialTitle);
            setFormat("ep");
            setSubmitted(false);
            setSaved(false);
          }}
        >
          Reset example
        </Button>
      </div>
      {saved && (
        <p role="status" className="text-sm text-success-foreground">
          Example saved locally in this story.
        </p>
      )}
    </form>
  );
}

export const EditRelease: Story = {
  render: () => <ReleaseForm />,
  play: async ({ canvas }) => {
    const title = canvas.getByRole("textbox", { name: "Release title" });
    await userEvent.clear(title);
    await userEvent.click(canvas.getByRole("button", { name: "Save changes" }));
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Enter the release title.",
    );
    await expect(title).toHaveAttribute("aria-invalid", "true");
    await userEvent.type(title, "Low Tide");
    await userEvent.click(canvas.getByRole("button", { name: "Save changes" }));
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Example saved locally",
    );
  },
};
export const Disabled: Story = { render: () => <ReleaseForm disabled /> };
export const Invalid: Story = {
  render: () => <ReleaseForm initialTitle="" showError />,
};
export const SourceOwned: Story = {
  render: () => (
    <div className="max-w-xl space-y-6">
      <Field>
        <FieldLabel htmlFor="library-followers">Spotify followers</FieldLabel>
        <Input
          id="library-followers"
          value="Not connected"
          readOnly
          aria-describedby="library-followers-help"
        />
        <FieldDescription id="library-followers-help">
          Supplied by Spotify after connecting the artist. Not entered manually.
        </FieldDescription>
      </Field>
      <p className="text-sm text-muted-foreground">
        Missing provider data is shown as unknown, rather than zero.
      </p>
    </div>
  ),
};
