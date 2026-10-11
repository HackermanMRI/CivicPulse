"""DEMO seed data (spec D12, N13).

Everything here is synthetic and labelled DEMO: reports and users carry `is_seed = true`, wards, markets and
commodities carry `is_demo = true`, photos are generated drawings stamped "DEMO · SYNTHETIC IMAGE", and ML scores
are stored with model_version "DEMO-synthetic". None of it may be used for training, validation, testing or any
reported metric; the export commands in app.cli refuse it.

    python -m app.cli seed-demo      # load (does nothing if already loaded)
    python -m app.cli reset-demo     # remove every DEMO record, keep all real records
"""
