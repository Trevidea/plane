"use client";

import { useState } from "react";
import { Button, EModalPosition, EModalWidth, ModalCore } from "@plane/ui";

interface ICreateOppositionTeamModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CreateOppositionTeamModal = ({ isOpen, onClose }: ICreateOppositionTeamModalProps) => {
  const [form, setForm] = useState({
    customerName: "",
    email: "",
    description: "",
    website: "",
    industry: "",
    employees: "",
    stage: "",
    contractStatus: "",
    revenue: "",
  });

  const update = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = () => {
    console.log("FORM DATA:", form);
    onClose();
  };

  return (
    <ModalCore
      isOpen={isOpen}
      handleClose={onClose}
      width={EModalWidth.XXXL}
      position={EModalPosition.TOP}
      className="p-6"
    >
      <h2 className="text-xl font-semibold mb-4">Create Opposition Team</h2>

      <div className="grid grid-cols-2 gap-4">
        {/* Customer Name */}
        <div className="col-span-2">
          <label className="label">Name *</label>
          <input
            className="w-full"
            placeholder="Enter name"
            value={form.customerName}
            onChange={(e) => update("customerName", e.target.value)}
          />
        </div>

        {/* Address */}
        <div className="col-span-2">
          <label className="label">Address *</label>
          <input
            className="w-full"
            placeholder="Enter Address"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
          />
        </div>


        {/* Athletic Director */}
        <div className="col-span-2">
          <label className="label">Athletic Director</label>
          <input
            className="w-full"
            placeholder="Athletic Director Name"
            value={form.website}
            onChange={(e) => update("website", e.target.value)}
          />
        </div>

        {/* Email */}
        <div>
          <label className="label">Email</label>
          <input
            className="w-full"
            placeholder="email"
            value={form.industry}
            onChange={(e) => update("industry", e.target.value)}
          />
        </div>

        {/* Phone */}
        <div>
          <label className="label">Phone</label>
          <input
            className="w-full"
            placeholder="phone"
            value={form.employees}
            onChange={(e) => update("employees", e.target.value)}
          />
        </div>

       {/* Assistant Athletic Director */}
        <div className="col-span-2">
          <label className="label">Assistant Athletic Director</label>
          <input
            className="w-full"
            placeholder="Assistant Athletic Director Name"
            value={form.website}
            onChange={(e) => update("website", e.target.value)}
          />
        </div>

        {/* Email */}
        <div>
          <label className="label">Email</label>
          <input
            className="w-full"
            placeholder="email"
            value={form.industry}
            onChange={(e) => update("industry", e.target.value)}
          />
        </div>

        {/* Phone */}
        <div>
          <label className="label">Phone</label>
          <input
            className="w-full"
            placeholder="phone"
            value={form.employees}
            onChange={(e) => update("employees", e.target.value)}
          />
        </div>
    </div>

      <div className="flex justify-end gap-2 mt-6">
        <Button variant="neutral-primary" size="sm" className="items-center gap-1" onClick={onClose}>
          Cancel
        </Button>

        <Button variant="primary" size="sm" className="items-center gap-1" onClick={handleSubmit}>
          Create Opposition Team
        </Button>
      </div>
    </ModalCore>
  );
};
