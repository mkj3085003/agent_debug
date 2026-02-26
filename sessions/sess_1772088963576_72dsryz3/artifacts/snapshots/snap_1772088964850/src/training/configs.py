from __future__ import annotations

from dataclasses import dataclass


@dataclass
class TrainingConfig:
    train_path: str
    val_path: str
    output_dir: str
    batch_size: int = 32
    max_steps: int = 1000
    learning_rate: float = 1e-4
