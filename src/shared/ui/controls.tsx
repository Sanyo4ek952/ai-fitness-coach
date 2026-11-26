"use client";

import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { Button as RadixButton, Select as RadixSelect, TextArea, TextField } from "@radix-ui/themes";
import type { ComponentProps, ReactNode } from "react";
import { ChevronDown } from "./icons";

export function Button({ type = "button", size = "3", ...props }: Readonly<ComponentProps<typeof RadixButton>>) {
  return <RadixButton type={type} size={size} {...props} />;
}

export function Input(props: Readonly<ComponentProps<typeof TextField.Root>>) {
  return <TextField.Root size="3" {...props} />;
}

export function Textarea(props: Readonly<ComponentProps<typeof TextArea>>) {
  return <TextArea size="3" {...props} />;
}

type SelectProps = Readonly<{
  name: string;
  label: string;
  defaultValue: string;
  options: readonly string[];
}>;

export function Select({ name, label, defaultValue, options }: SelectProps) {
  return (
    <RadixSelect.Root size="3" name={name} defaultValue={defaultValue}>
      <RadixSelect.Trigger aria-label={label} className="select-trigger" />
      <RadixSelect.Content position="popper" className="select-content">
        {options.map((option) => <RadixSelect.Item key={option} value={option}>{option}</RadixSelect.Item>)}
      </RadixSelect.Content>
    </RadixSelect.Root>
  );
}

export function Accordion({ title, children, className = "", defaultOpen = false }: Readonly<{ title: string; children: ReactNode; className?: string; defaultOpen?: boolean }>) {
  return (
    <AccordionPrimitive.Root type="single" collapsible defaultValue={defaultOpen ? "content" : undefined} className={`accordion ${className}`}>
      <AccordionPrimitive.Item value="content">
        <AccordionPrimitive.Header className="accordion-heading">
          <AccordionPrimitive.Trigger className="accordion-trigger">
            <span>{title}</span><ChevronDown className="accordion-chevron" size={20} strokeWidth={1.8} aria-hidden="true" focusable="false" />
          </AccordionPrimitive.Trigger>
        </AccordionPrimitive.Header>
        {/* Скрытие не размонтирует поля: RIR остаётся в FormData после закрытия. */}
        <AccordionPrimitive.Content forceMount className="accordion-content">{children}</AccordionPrimitive.Content>
      </AccordionPrimitive.Item>
    </AccordionPrimitive.Root>
  );
}
