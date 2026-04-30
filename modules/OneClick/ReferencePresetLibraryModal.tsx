import React, { useState } from 'react';
import { OneClickReferencePreset, OneClickSubMode } from '../../types';
import ReferencePresetEditorModal from './ReferencePresetEditorModal';
import ReferencePresetManager from './ReferencePresetManager';

interface Props {
  open: boolean;
  title: string;
  subMode: OneClickSubMode;
  presets: OneClickReferencePreset[];
  onClose: () => void;
  onApply: (preset: OneClickReferencePreset) => void;
  onSaveCurrent?: () => void;
  onCreate: (preset: OneClickReferencePreset) => void;
  onUpdate: (preset: OneClickReferencePreset) => void;
  onDelete: (id: string) => void;
  createEmptyPreset: () => OneClickReferencePreset;
}

const ReferencePresetLibraryModal: React.FC<Props> = ({
  open,
  title,
  subMode,
  presets,
  onClose,
  onApply,
  onSaveCurrent,
  onCreate,
  onUpdate,
  onDelete,
  createEmptyPreset,
}) => {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingPreset, setEditingPreset] = useState<OneClickReferencePreset | null>(null);

  const openCreate = () => {
    setEditorMode('create');
    setEditingPreset(createEmptyPreset());
    setEditorOpen(true);
  };

  const openEdit = (preset: OneClickReferencePreset) => {
    setEditorMode('edit');
    setEditingPreset(preset);
    setEditorOpen(true);
  };

  const handleSubmit = (preset: OneClickReferencePreset) => {
    if (editorMode === 'create') {
      onCreate(preset);
    } else {
      onUpdate(preset);
    }
    setEditorOpen(false);
    setEditingPreset(null);
  };

  return (
    <>
      <ReferencePresetManager
        open={open}
        title={title}
        activeSubMode={subMode}
        presets={presets}
        onClose={onClose}
        onApply={onApply}
        onEdit={openEdit}
        onDelete={onDelete}
        onCreate={openCreate}
        onSaveCurrent={onSaveCurrent}
      />
      <ReferencePresetEditorModal
        open={editorOpen}
        mode={editorMode}
        initialValue={editingPreset}
        onClose={() => {
          setEditorOpen(false);
          setEditingPreset(null);
        }}
        onSubmit={handleSubmit}
      />
    </>
  );
};

export default ReferencePresetLibraryModal;
