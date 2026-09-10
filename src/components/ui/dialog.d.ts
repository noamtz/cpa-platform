import type * as React from "react";
import type * as DialogPrimitive from "@radix-ui/react-dialog";

export const Dialog: typeof DialogPrimitive.Root;
export const DialogPortal: typeof DialogPrimitive.Portal;
export const DialogTrigger: typeof DialogPrimitive.Trigger;
export const DialogClose: typeof DialogPrimitive.Close;
export const DialogOverlay: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> &
  React.RefAttributes<React.ElementRef<typeof DialogPrimitive.Overlay>>
>;
export const DialogContent: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> &
  React.RefAttributes<React.ElementRef<typeof DialogPrimitive.Content>>
>;
export const DialogHeader: React.FC<React.HTMLAttributes<HTMLDivElement>>;
export const DialogFooter: React.FC<React.HTMLAttributes<HTMLDivElement>>;
export const DialogTitle: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title> &
  React.RefAttributes<React.ElementRef<typeof DialogPrimitive.Title>>
>;
export const DialogDescription: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description> &
  React.RefAttributes<React.ElementRef<typeof DialogPrimitive.Description>>
>;
