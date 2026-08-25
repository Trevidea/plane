"use client";

import React, { useRef, useState } from "react";
import { observer } from "mobx-react";
import { createPortal } from "react-dom";
import { usePopper } from "react-popper";
import { Ban, MapPin, Search, X } from "lucide-react";

import { ComboDropDown } from "@plane/ui";
import { cn } from "@plane/utils";
import { DropdownButton } from "@/components/dropdowns/buttons";
import { BUTTON_VARIANTS_WITH_TEXT } from "@/components/dropdowns/constants";
import type { TDropdownProps } from "@/components/dropdowns/types";
import { useDropdown } from "@/hooks/use-dropdown";

type Props = TDropdownProps & {
  value?: string | null;
  onChange?: (val: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  renderByDefault?: boolean;
  icon?: React.ReactNode;
  clearIconClassName?: string;
  dropdownClassName?: string;
};

const LOCATION_OPTIONS = ["Home", "Away"];

export const LocationDropdown: React.FC<Props> = observer((props) => {
  const {
    className = "",
    buttonClassName = "p-1.5",
    buttonContainerClassName = "",
    clearIconClassName = "",
    placeholder = "Location",
    buttonVariant,
    renderByDefault = true,
    icon = <MapPin className="h-3 w-3 flex-shrink-0" />,
    hideIcon = false,
    showTooltip = false,
    disabled = false,
    value,
    onChange,
    dropdownClassName = "",
  } = props;

  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);

  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: "bottom-start",
    modifiers: [{ name: "preventOverflow", options: { padding: 12 } }],
  });

  const { handleClose, handleKeyDown, handleOnClick } = useDropdown({
    dropdownRef,
    isOpen,
    setIsOpen,
  });

  const filteredLocations = LOCATION_OPTIONS.filter((location) =>
    location.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (location: string | null) => {
    onChange?.(location);
    setSearch("");
    handleClose();
    referenceElement?.blur();
  };

  const displayValue = value || placeholder;

  const comboButton = (
    <button
      type="button"
      ref={setReferenceElement}
      onClick={handleOnClick}
      disabled={disabled}
      className={cn(
        "clickable block h-full max-w-full outline-none",
        {
          "cursor-default text-custom-text-200": disabled,
          "cursor-pointer": !disabled,
        },
        buttonContainerClassName
      )}
    >
      <DropdownButton
        className={buttonClassName}
        isActive={isOpen}
        tooltipHeading={placeholder}
        tooltipContent={displayValue}
        showTooltip={showTooltip}
        variant={buttonVariant}
        renderToolTipByDefault={renderByDefault}
      >
        {!hideIcon && icon}

        {BUTTON_VARIANTS_WITH_TEXT.includes(buttonVariant) && (
          <span className="min-w-0 flex-grow truncate">{displayValue}</span>
        )}

        {!!value && !disabled && (
          <X
            className={cn("h-2.5 w-2.5 flex-shrink-0", clearIconClassName)}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleSelect(null);
            }}
          />
        )}
      </DropdownButton>
    </button>
  );

  return (
    <ComboDropDown
      as="div"
      ref={dropdownRef}
      className={cn("h-full", className)}
      button={comboButton}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      renderByDefault={renderByDefault}
    >
      {isOpen &&
        createPortal(
          <div
            ref={setPopperElement}
            style={styles.popper}
            {...attributes.popper}
            className={cn(
              "my-1 w-52 overflow-hidden rounded-md border-[0.5px] border-custom-border-300 bg-custom-background-100 shadow-custom-shadow-rg z-30",
              dropdownClassName
            )}
          >
            <div className="relative p-2">
              <Search className="absolute left-4 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="w-full rounded bg-custom-background-90 py-1 pl-8 pr-2 text-xs outline-none"
              />
            </div>

            <div
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleSelect(null);
              }}
              className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-custom-background-80"
            >
              <Ban className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-xs text-gray-400">None</span>
            </div>

            {filteredLocations.map((location) => (
              <div
                key={location}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSelect(location);
                }}
                className={cn(
                  "cursor-pointer px-2 py-1 text-xs hover:bg-custom-background-80",
                  value === location && "bg-custom-background-80 font-medium"
                )}
              >
                {location}
              </div>
            ))}
          </div>,
          document.body
        )}
    </ComboDropDown>
  );
});

export default LocationDropdown;
