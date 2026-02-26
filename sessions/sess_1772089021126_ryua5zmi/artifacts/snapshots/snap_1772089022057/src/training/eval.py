from __future__ import annotations

from src.training.configs import TrainingConfig


def evaluate(cfg: TrainingConfig) -> None:
    print("Evaluation loop placeholder")
    print(cfg)


if __name__ == "__main__":
    config = TrainingConfig(train_path="data/raw/train.json", val_path="data/raw/val.json", output_dir="experiments/runs")
    evaluate(config)
